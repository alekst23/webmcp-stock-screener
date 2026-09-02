import { describe, expect, it } from 'vitest';
// The evaluator's own source, so a test can assert it names no operation kind.
import evaluatorSource from './batchEvaluation.ts?raw';
import { createOperationRegistry } from '../application/operationRegistry';
import type { OperationDefinition, OperationRegistry } from '../application/operationRegistry';
import type { MutationDraft } from '../application/revisionService';
import { evaluateBatch } from './batchEvaluation';
import { createIdSequencer } from './ids';
import type { IdSequencer, ResourceId } from './ids';
import type { ChangeBatch } from './preview';
import { SafetyError } from './previewErrors';
import { emptyWorkspace } from './workspace';
import type { PanelRecord, WorkspaceDocument } from './workspace';

function panel(id: ResourceId, title: string): PanelRecord {
	return {
		id,
		kind: 'chart',
		title,
		collapsed: false,
		visible: true,
		boundResourceId: null,
		config: {}
	};
}

function baseDocument(): WorkspaceDocument {
	const doc = emptyWorkspace('workspace_1', 'Workbench', '2026-01-01T00:00:00.000Z');
	return { ...doc, revision: 7, panels: [panel('panel_chart_1', 'Original')] };
}

// Every part is overridable so a test can make exactly one of validate,
// describe or apply misbehave and leave the rest ordinary.
function defineOperation(
	kind: string,
	parts: Partial<Omit<OperationDefinition, 'kind' | 'inputSchema'>> = {}
): OperationDefinition {
	return {
		kind,
		inputSchema: {},
		validate: parts.validate ?? (() => []),
		describe: parts.describe ?? (() => `Describe ${kind}.`),
		apply:
			parts.apply ??
			((_input, doc) => ({ document: doc, affectedIds: [], diffSummary: `Applied ${kind}.` }))
	};
}

function addPanel(id: ResourceId, title: string, extra: Partial<MutationDraft> = {}) {
	return (_input: unknown, doc: WorkspaceDocument): MutationDraft => ({
		document: { ...doc, panels: [...doc.panels, panel(id, title)] },
		affectedIds: [id],
		diffSummary: `Added panel ${title}.`,
		...extra
	});
}

function registryWith(...definitions: OperationDefinition[]): OperationRegistry {
	// A fresh registry per test: mutating the shared singleton would make the
	// suite order-dependent.
	const registry = createOperationRegistry();
	for (const definition of definitions) {
		registry.register(definition);
	}
	return registry;
}

// Records every ID it hands out, so a test can assert that evaluation itself
// minted none while still letting a handler mint some.
function spySequencer(): { sequencer: IdSequencer; issued: ResourceId[] } {
	const inner = createIdSequencer();
	const issued: ResourceId[] = [];
	return {
		issued,
		sequencer: {
			next(kind, discriminator) {
				const id = inner.next(kind, discriminator);
				issued.push(id);
				return id;
			}
		}
	};
}

function depsFor(registry: OperationRegistry): { registry: OperationRegistry; ids: IdSequencer } {
	return { registry, ids: createIdSequencer() };
}

function batch(...kinds: string[]): ChangeBatch {
	return kinds.map((kind) => ({ kind, input: {} }));
}

describe('evaluateBatch: what it reports (AC1)', () => {
	it('returns a candidate state, affected IDs, warnings, failures and outcomes', () => {
		const registry = registryWith(
			defineOperation('panels.add', {
				describe: () => 'Add a chart panel.',
				apply: addPanel('panel_chart_2', 'Added', { warnings: ['Panel added off-screen.'] })
			})
		);
		const document = baseDocument();

		const result = evaluateBatch(batch('panels.add'), document, depsFor(registry));

		expect(result.candidate, 'a valid batch must yield a committable candidate').not.toBeNull();
		expect(
			result.candidate?.panels.map((p) => p.id),
			'the candidate carries the effect of the operation'
		).toEqual(['panel_chart_1', 'panel_chart_2']);
		expect(result.affectedIds, 'affected IDs come from the drafts').toEqual(['panel_chart_2']);
		expect(result.failures, 'a valid batch reports no failures').toEqual([]);
		expect(result.warnings, 'handler warnings are carried with their position and kind').toEqual([
			{ index: 0, kind: 'panels.add', message: 'Panel added off-screen.' }
		]);
		expect(result.outcomes, 'one outcome per operation, carrying describe()').toEqual([
			{
				index: 0,
				kind: 'panels.add',
				describe: 'Add a chart panel.',
				failures: [],
				warnings: [{ index: 0, kind: 'panels.add', message: 'Panel added off-screen.' }]
			}
		]);
		expect(result.fragments, 'fragments come from each draft diffSummary').toEqual([
			'Added panel Added.'
		]);
	});

	it('deduplicates affected IDs in first-appearance order', () => {
		const registry = registryWith(
			defineOperation('panels.touch_b', {
				apply: (_input, doc) => ({
					document: doc,
					affectedIds: ['panel_chart_9', 'panel_chart_1'],
					diffSummary: 'Touched b.'
				})
			}),
			defineOperation('panels.touch_a', {
				apply: (_input, doc) => ({
					document: doc,
					affectedIds: ['panel_chart_1', 'panel_chart_5'],
					diffSummary: 'Touched a.'
				})
			})
		);

		const result = evaluateBatch(
			batch('panels.touch_b', 'panels.touch_a'),
			baseDocument(),
			depsFor(registry)
		);

		expect(
			result.affectedIds,
			'the same ID twice is reported once, where it first appeared'
		).toEqual(['panel_chart_9', 'panel_chart_1', 'panel_chart_5']);
	});
});

describe('evaluateBatch: ordering (AC2)', () => {
	it('lets a later operation see the state an earlier one produced', () => {
		const seenTitles: string[][] = [];
		const registry = registryWith(
			defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'From first') }),
			defineOperation('panels.rename_last', {
				validate: (_input, doc) =>
					doc.panels.length === 2 ? [] : [`expected 2 panels, saw ${doc.panels.length}`],
				describe: (_input, doc) => `Rename ${doc.panels[doc.panels.length - 1]?.title}.`,
				apply: (_input, doc) => {
					seenTitles.push(doc.panels.map((p) => p.title));
					const renamed = doc.panels.map((p, i) =>
						i === doc.panels.length - 1 ? { ...p, title: 'Renamed' } : p
					);
					return {
						document: { ...doc, panels: renamed },
						affectedIds: [],
						diffSummary: 'Renamed.'
					};
				}
			})
		);

		const result = evaluateBatch(
			batch('panels.add', 'panels.rename_last'),
			baseDocument(),
			depsFor(registry)
		);

		expect(result.failures, 'the second operation validates against the first result').toEqual([]);
		expect(seenTitles, 'the second handler was handed the first operation output').toEqual([
			['Original', 'From first']
		]);
		expect(
			result.candidate?.panels.map((p) => p.title),
			'both effects compose into the candidate'
		).toEqual(['Original', 'Renamed']);
		expect(result.outcomes[1]?.describe, 'describe() also sees the folded state').toBe(
			'Rename From first.'
		);
	});

	it('reverses the outcome when the same operations are proposed in the other order', () => {
		const buildRegistry = (): OperationRegistry =>
			registryWith(
				defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'Added') }),
				defineOperation('panels.count', {
					apply: (_input, doc) => ({
						document: { ...doc, name: `${doc.panels.length} panels` },
						affectedIds: [],
						diffSummary: 'Counted.'
					})
				})
			);

		const forward = evaluateBatch(
			batch('panels.add', 'panels.count'),
			baseDocument(),
			depsFor(buildRegistry())
		);
		const reversed = evaluateBatch(
			batch('panels.count', 'panels.add'),
			baseDocument(),
			depsFor(buildRegistry())
		);

		expect(forward.candidate?.name, 'counting after adding sees the added panel').toBe('2 panels');
		expect(reversed.candidate?.name, 'counting before adding does not').toBe('1 panels');
	});
});

describe('evaluateBatch: registry-driven dispatch (AC3, AC11)', () => {
	it('drives a kind registered by the test and named nowhere in the evaluator', () => {
		const novelKind = 'quasar.entangle_dimensions';
		expect(
			evaluatorSource.includes('quasar'),
			'the evaluator must contain no kind-specific logic'
		).toBe(false);

		const registry = registryWith(
			defineOperation(novelKind, {
				describe: () => 'Entangle two dimensions.',
				apply: (_input, doc) => ({
					document: { ...doc, extensions: { ...doc.extensions, quasar: { entangled: true } } },
					affectedIds: ['panel_chart_1'],
					diffSummary: 'Entangled.'
				})
			})
		);

		const result = evaluateBatch(
			[{ kind: novelKind, input: {} }],
			baseDocument(),
			depsFor(registry)
		);

		expect(result.failures, 'an unknown-to-the-evaluator kind is still evaluable').toEqual([]);
		expect(result.candidate?.extensions, 'the handler effect lands in the candidate').toEqual({
			quasar: { entangled: true }
		});
		expect(result.outcomes[0]?.describe, 'the registered describe() is used verbatim').toBe(
			'Entangle two dimensions.'
		);
	});

	it('treats two differently named kinds with identical handlers identically', () => {
		const shared = (_input: unknown, doc: WorkspaceDocument): MutationDraft => ({
			document: { ...doc, activeSymbol: 'AAPL' },
			affectedIds: ['panel_chart_1'],
			diffSummary: 'Set symbol.'
		});
		const first = evaluateBatch(
			batch('alpha.act'),
			baseDocument(),
			depsFor(registryWith(defineOperation('alpha.act', { apply: shared })))
		);
		const second = evaluateBatch(
			batch('omega.act'),
			baseDocument(),
			depsFor(registryWith(defineOperation('omega.act', { apply: shared })))
		);

		expect(first.candidate, 'the evaluator branches on no particular kind').toEqual(
			second.candidate
		);
		expect(first.affectedIds, 'nor on kind for affected IDs').toEqual(second.affectedIds);
	});
});

describe('evaluateBatch: failures (AC4, AC5, AC6)', () => {
	it('reports an unregistered kind by position and kind, and keeps folding', () => {
		const registry = registryWith(
			defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'Added') })
		);

		const result = evaluateBatch(
			batch('panels.add', 'panels.nonexistent'),
			baseDocument(),
			depsFor(registry)
		);

		expect(result.failures, 'an unknown kind names its position and kind').toEqual([
			{ index: 1, kind: 'panels.nonexistent', reason: 'unknown operation kind: panels.nonexistent' }
		]);
		expect(result.outcomes.length, 'every operation still gets an outcome').toBe(2);
		expect(result.outcomes[0]?.failures, 'the healthy operation is not tainted').toEqual([]);
	});

	it('reports two independently bad operations rather than stopping at the first', () => {
		const registry = registryWith(
			defineOperation('panels.rejected', { validate: () => ['title must not be empty'] }),
			defineOperation('panels.explodes', {
				apply: () => {
					throw new Error('handler blew up');
				}
			})
		);

		const result = evaluateBatch(
			batch('panels.rejected', 'panels.unregistered', 'panels.explodes'),
			baseDocument(),
			depsFor(registry)
		);

		expect(
			result.failures.map((f) => [f.index, f.kind]),
			'the fold continues so every independent failure is reported'
		).toEqual([
			[0, 'panels.rejected'],
			[1, 'panels.unregistered'],
			[2, 'panels.explodes']
		]);
	});

	it("carries the validator's own reason (AC5)", () => {
		const registry = registryWith(
			defineOperation('panels.rejected', {
				validate: () => ['panel_chart_9 does not exist', 'width must be positive'],
				describe: () => 'Configure a panel.'
			})
		);

		const result = evaluateBatch(batch('panels.rejected'), baseDocument(), depsFor(registry));

		expect(result.failures[0]?.reason, 'every validator issue reaches the caller').toBe(
			'panel_chart_9 does not exist; width must be positive'
		);
		expect(result.outcomes[0]?.describe, 'a rejected operation still describes itself').toBe(
			'Configure a panel.'
		);
	});

	it('turns a throwing validator into a failure rather than crashing', () => {
		const registry = registryWith(
			defineOperation('panels.hostile', {
				validate: () => {
					throw new Error('validator exploded');
				}
			})
		);

		const result = evaluateBatch(batch('panels.hostile'), baseDocument(), depsFor(registry));

		expect(result.failures, 'a throwing validator is one operation failing').toEqual([
			{ index: 0, kind: 'panels.hostile', reason: 'validator exploded' }
		]);
	});

	it('turns a throwing describe() into a failure rather than crashing', () => {
		const registry = registryWith(
			defineOperation('panels.mute', {
				describe: () => {
					throw new Error('describe exploded');
				}
			})
		);

		const result = evaluateBatch(batch('panels.mute'), baseDocument(), depsFor(registry));

		expect(result.failures[0]?.reason, 'describe() is guarded like validate() and apply()').toBe(
			'describe exploded'
		);
	});

	it('continues from the last known-good state after a failing operation', () => {
		const seenPanelCounts: number[] = [];
		const registry = registryWith(
			defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'Added') }),
			defineOperation('panels.explodes', {
				apply: (_input, doc) => {
					doc.panels.push(panel('panel_chart_99', 'Ghost'));
					throw new Error('handler blew up after mutating');
				}
			}),
			defineOperation('panels.observe', {
				apply: (_input, doc) => {
					seenPanelCounts.push(doc.panels.length);
					return { document: doc, affectedIds: [], diffSummary: 'Observed.' };
				}
			})
		);

		evaluateBatch(
			batch('panels.add', 'panels.explodes', 'panels.observe'),
			baseDocument(),
			depsFor(registry)
		);

		expect(
			seenPanelCounts,
			'a failed handler contributes nothing, not even what it mutated before throwing'
		).toEqual([2]);
	});

	it('yields no candidate at all when any operation fails (AC6)', () => {
		const registry = registryWith(
			defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'Added') }),
			defineOperation('panels.rejected', { validate: () => ['nope'] })
		);

		const result = evaluateBatch(
			batch('panels.add', 'panels.rejected'),
			baseDocument(),
			depsFor(registry)
		);

		expect(result.candidate, 'a caller must have nothing commitable when a batch fails').toBeNull();
		expect(result.failures.length, 'the failure is still reported in full').toBe(1);
		expect(result.fragments, 'the successful operation still contributes its fragment').toEqual([
			'Added panel Added.'
		]);
	});
});

describe('evaluateBatch: the live state is never touched (AC7)', () => {
	function expectUntouched<T>(document: WorkspaceDocument, run: () => T, why: string): T {
		const before = structuredClone(document);
		const beforeRevision = document.revision;
		const produced = run();
		expect(document, why).toEqual(before);
		expect(document.revision, `${why} (revision)`).toBe(beforeRevision);
		return produced;
	}

	it('leaves the document unchanged for a batch that succeeds', () => {
		const registry = registryWith(
			defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'Added') })
		);
		const document = baseDocument();
		expectUntouched(
			document,
			() => evaluateBatch(batch('panels.add'), document, depsFor(registry)),
			'a successful evaluation must not write through to the caller state'
		);
	});

	it('leaves the document unchanged for an unknown kind', () => {
		const document = baseDocument();
		expectUntouched(
			document,
			() =>
				evaluateBatch(batch('panels.nonexistent'), document, depsFor(createOperationRegistry())),
			'an unresolvable kind changes nothing'
		);
	});

	it('leaves the document unchanged when a validator rejects', () => {
		const registry = registryWith(defineOperation('panels.rejected', { validate: () => ['nope'] }));
		const document = baseDocument();
		expectUntouched(
			document,
			() => evaluateBatch(batch('panels.rejected'), document, depsFor(registry)),
			'a rejected batch changes nothing'
		);
	});

	it('leaves the document unchanged when a handler throws', () => {
		const registry = registryWith(
			defineOperation('panels.explodes', {
				apply: () => {
					throw new Error('handler blew up');
				}
			})
		);
		const document = baseDocument();
		expectUntouched(
			document,
			() => evaluateBatch(batch('panels.explodes'), document, depsFor(registry)),
			'a throwing handler changes nothing'
		);
	});

	it('leaves the document unchanged even when a handler mutates what it is handed', () => {
		// The load-bearing case: handlers are not guaranteed pure, so this is
		// what the per-operation clone exists for.
		const registry = registryWith(
			defineOperation('panels.impure', {
				validate: (_input, doc) => {
					doc.activeSymbol = 'MUTATED_IN_VALIDATE';
					return [];
				},
				apply: (_input, doc) => {
					doc.panels.push(panel('panel_chart_2', 'Mutated in place'));
					doc.name = 'Renamed in place';
					doc.extensions.impure = true;
					return { document: doc, affectedIds: ['panel_chart_2'], diffSummary: 'Mutated.' };
				}
			})
		);
		const document = baseDocument();

		const evaluation = expectUntouched(
			document,
			() => evaluateBatch(batch('panels.impure'), document, depsFor(registry)),
			'an impure handler mutates its own private clone, never the caller state'
		);

		expect(
			evaluation.candidate?.panels.map((p) => p.id),
			'the impure handler effects still land in the candidate'
		).toEqual(['panel_chart_1', 'panel_chart_2']);
		expect(evaluation.candidate?.name, 'including its in-place rename').toBe('Renamed in place');
	});

	it('never hands a handler the caller document object itself', () => {
		const handed: WorkspaceDocument[] = [];
		const registry = registryWith(
			defineOperation('panels.capture', {
				apply: (_input, doc) => {
					handed.push(doc);
					return { document: doc, affectedIds: [], diffSummary: 'Captured.' };
				}
			})
		);
		const document = baseDocument();

		const result = evaluateBatch(batch('panels.capture'), document, depsFor(registry));

		expect(handed[0] === document, 'the handler receives a clone, not the live value').toBe(false);
		expect(handed[0], 'the clone is structurally equal to the live value').toEqual(document);
		expect(
			result.candidate === document,
			'nor can the candidate alias the live value a caller still holds'
		).toBe(false);
	});
});

describe('evaluateBatch: input and no-op edge cases (AC8, AC9)', () => {
	it('rejects an empty batch as invalid input', () => {
		const deps = depsFor(createOperationRegistry());

		expect(
			() => evaluateBatch([], baseDocument(), deps),
			'an empty batch is a caller mistake, not an outcome to report'
		).toThrow(SafetyError);
		try {
			evaluateBatch([], baseDocument(), deps);
			expect.fail('evaluateBatch must throw on an empty batch');
		} catch (err) {
			expect(err instanceof SafetyError && err.reason, 'the reason is machine-branchable').toBe(
				'invalid_input'
			);
		}
	});

	it('succeeds with no affected IDs when every operation is a no-op', () => {
		const registry = registryWith(
			defineOperation('panels.noop_one'),
			defineOperation('panels.noop_two')
		);

		const result = evaluateBatch(
			batch('panels.noop_one', 'panels.noop_two'),
			baseDocument(),
			depsFor(registry)
		);

		expect(result.failures, 'changing nothing is not a failure').toEqual([]);
		expect(result.candidate, 'a no-op batch still yields a committable candidate').not.toBeNull();
		expect(result.candidate, 'the candidate equals the input state').toEqual(baseDocument());
		expect(result.affectedIds, 'a no-op batch affects nothing').toEqual([]);
	});
});

describe('evaluateBatch: purity of the evaluator itself (AC10)', () => {
	it('mints no IDs of its own', () => {
		const { sequencer, issued } = spySequencer();
		const registry = registryWith(
			defineOperation('panels.add', { apply: addPanel('panel_chart_2', 'Added') }),
			defineOperation('panels.rejected', { validate: () => ['nope'] })
		);

		evaluateBatch(batch('panels.add', 'panels.rejected'), baseDocument(), {
			registry,
			ids: sequencer
		});

		expect(issued, 'evaluation itself never calls ids.next(); it only threads one through').toEqual(
			[]
		);
	});

	it('passes the sequencer through to handlers that need one', () => {
		const { sequencer, issued } = spySequencer();
		const registry = registryWith(
			defineOperation('panels.add', {
				apply: (_input, doc, ids) => {
					const id = ids.next('panel', 'chart');
					return {
						document: { ...doc, panels: [...doc.panels, panel(id, 'Minted')] },
						affectedIds: [id],
						diffSummary: `Added ${id}.`
					};
				}
			})
		);

		const result = evaluateBatch(batch('panels.add'), baseDocument(), {
			registry,
			ids: sequencer
		});

		expect(issued, 'a handler that mints an ID gets a working sequencer').toEqual([
			'panel_chart_1'
		]);
		expect(
			result.affectedIds,
			'the IDs minted during evaluation are the ones a later apply commits'
		).toEqual(['panel_chart_1']);
	});
});
