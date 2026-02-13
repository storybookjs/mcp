interface JudgePrompt {
	judgeInstruction?: string;
	renderedTaskPrompt?: string;
	effectivePrompt?: string;
	fullJudgePrompt?: string;
}

interface JudgeEvidence {
	finalAssistantText?: string;
	lastUserToolResults?: string;
}

interface JudgeProps {
	agent: string;
	model: string;
	score: number;
	reason: string;
	raw?: string;
	prompt?: JudgePrompt;
	evidence?: JudgeEvidence;
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
	<div style={{ marginBottom: '1.5rem' }}>
		<h2
			style={{
				fontSize: '1.125rem',
				fontWeight: 600,
				marginBottom: '0.75rem',
			}}
		>
			{title}
		</h2>
		{children}
	</div>
);

const CodeBlock = ({ value }: { value: string }) => (
	<pre
		style={{
			margin: 0,
			padding: '1rem',
			backgroundColor: '#111827',
			color: '#f9fafb',
			borderRadius: '8px',
			overflow: 'auto',
			whiteSpace: 'pre-wrap',
			wordBreak: 'break-word',
			fontSize: '0.875rem',
			fontFamily: 'monospace',
		}}
	>
		{value}
	</pre>
);

const MetricCard = ({ label, value }: { label: string; value: string }) => (
	<div
		style={{
			padding: '1rem 1.25rem',
			backgroundColor: '#f9fafb',
			border: '1px solid #e5e7eb',
			borderRadius: '8px',
		}}
	>
		<div
			style={{
				fontSize: '0.75rem',
				fontWeight: 600,
				color: '#6b7280',
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
				marginBottom: '0.25rem',
			}}
		>
			{label}
		</div>
		<div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#111827' }}>{value}</div>
	</div>
);

export const Judge = (props: JudgeProps) => {
	const scorePct = `${(props.score * 100).toFixed(0)}%`;

	return (
		<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
			<h1 style={{ marginTop: 0 }}>Judge</h1>

			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
					gap: '1rem',
					marginBottom: '1.5rem',
				}}
			>
				<MetricCard label="Score" value={scorePct} />
				<MetricCard label="Agent" value={props.agent} />
				<MetricCard label="Model" value={props.model} />
			</div>

			<Section title="Reason">
				<div
					style={{
						padding: '1rem',
						backgroundColor: '#f8fafc',
						border: '1px solid #e2e8f0',
						borderRadius: '8px',
						color: '#0f172a',
						lineHeight: 1.5,
					}}
				>
					{props.reason}
				</div>
			</Section>

			{props.prompt?.effectivePrompt && (
				<Section title="Judge input prompt">
					<CodeBlock value={props.prompt.effectivePrompt} />
				</Section>
			)}

			{props.evidence?.finalAssistantText && (
				<Section title="Evidence: final assistant response">
					<CodeBlock value={props.evidence.finalAssistantText} />
				</Section>
			)}

			{props.evidence?.lastUserToolResults && (
				<Section title="Evidence: last user tool results">
					<CodeBlock value={props.evidence.lastUserToolResults} />
				</Section>
			)}

			{props.raw && (
				<Section title="Raw judge output">
					<CodeBlock value={props.raw} />
				</Section>
			)}
		</div>
	);
};
