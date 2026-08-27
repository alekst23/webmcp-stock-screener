// Handle-based research workbench model: every tool operates on ids the agent
// receives from earlier calls and the human can see in the UI.

export interface StudySummary {
	id: string;
	name: string;
	expression: string;
}

export interface SetupStep {
	condition: string;
	// Trading days after the previous step in which the condition must occur.
	within?: [number, number];
	// Condition must hold on every day of the window, not just once.
	sustained?: boolean;
}

export interface SetupSummary {
	id: string;
	name?: string;
	steps: SetupStep[];
}

export interface InstanceEvent {
	ticker: string;
	// ISO date of the event anchor (t=0), i.e. the day the final step completed.
	date: string;
}

export interface InstanceSetSummary {
	id: string;
	setupId: string;
	count: number;
	from: string;
	to: string;
	// Set this split was derived from, if any.
	parentId?: string;
	label?: string;
}

export interface PanelSummary {
	id: string;
	kind: 'grid' | 'histogram' | 'chart';
	instanceSetId?: string;
}

export interface FocusState {
	panelId: string;
	// Instances the human has selected/highlighted by hand.
	selected: InstanceEvent[];
}

export interface WorkspaceState {
	studies: StudySummary[];
	setups: SetupSummary[];
	instanceSets: InstanceSetSummary[];
	panels: PanelSummary[];
	focus: FocusState | null;
}

export interface DefineStudyInput {
	name: string;
	expression: string;
}

export interface DefineSetupInput {
	name?: string;
	steps: SetupStep[];
}

export interface FindInstancesInput {
	setupId: string;
	from?: string;
	to?: string;
	universe?: { minMarketCap?: number; sectors?: string[] };
}

export interface SampleInstancesInput {
	instanceSetId: string;
	n?: number;
	strategy?: 'random' | 'recent' | 'best' | 'worst';
	horizonDays?: number;
}

export interface MeasureInput {
	instanceSetId: string;
	metric?: string;
	horizonDays: number;
	compareToBaseRate?: boolean;
}

export interface MeasureResult {
	metric: string;
	horizonDays: number;
	count: number;
	median: number;
	mean: number;
	hitRate: number;
	baseRate?: { median: number; hitRate: number };
}

export interface SplitInstancesInput {
	instanceSetId: string;
	mode: 'outcome' | 'condition';
	// mode=condition: expression evaluated at each instance's t=0.
	expression?: string;
	// mode=outcome: forward-return horizon and threshold separating win/loss.
	horizonDays?: number;
	threshold?: number;
}

export interface ShowGridInput {
	instanceSetId: string;
	n?: number;
	strategy?: 'random' | 'recent' | 'best' | 'worst';
	// Trading days around t=0 to display, e.g. [-20, 20].
	window?: [number, number];
	overlayStudyIds?: string[];
	normalize?: boolean;
}

export interface FocusInstanceInput {
	ticker: string;
	date: string;
	panelId?: string;
}

// Thrown by the engine when an expression fails to parse; the catalog is
// returned to the agent so it can self-correct instead of looping.
export class ExpressionError extends Error {
	constructor(
		message: string,
		readonly catalog: string[]
	) {
		super(message);
		this.name = 'ExpressionError';
	}
}

export interface ResearchEngine {
	defineStudy(input: DefineStudyInput): Promise<StudySummary>;
	defineSetup(input: DefineSetupInput): Promise<SetupSummary>;
	findInstances(input: FindInstancesInput): Promise<InstanceSetSummary>;
	sampleInstances(input: SampleInstancesInput): Promise<InstanceEvent[]>;
	measure(input: MeasureInput): Promise<MeasureResult>;
	splitInstances(input: SplitInstancesInput): Promise<InstanceSetSummary[]>;
	showGrid(input: ShowGridInput): Promise<PanelSummary>;
	focusInstance(input: FocusInstanceInput): Promise<void>;
	getWorkspace(): Promise<WorkspaceState>;
}

export interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

export interface ToolSpec {
	name: string;
	description: string;
	inputSchema: object;
	available(ws: WorkspaceState): boolean;
	execute(input: unknown): Promise<ToolResult>;
}

// Minimal ambient typing for the draft WebMCP API (document.modelContext).
// The spec is a moving early-preview target; keep this surface small.
export interface ModelContextToolDescriptor {
	name: string;
	description: string;
	inputSchema: object;
	execute(input: unknown): Promise<ToolResult>;
}

export interface ModelContext {
	registerTool(tool: ModelContextToolDescriptor): Promise<void>;
	unregisterTool?(name: string): Promise<void>;
}

declare global {
	interface Document {
		modelContext?: ModelContext;
	}
}
