interface SummaryProps {
	agent: string;
	model: string;
	cost?: number;
	duration: number;
	durationApi: number;
	turns: number;
	buildSuccess: boolean;
	typeCheckErrors: number;
	lintErrors: number;
	test: {
		passed: number;
		failed: number;
	};
	a11y: {
		violations: number;
	};
	coverage?: {
		branches: number | null;
		functions: number | null;
		lines: number | null;
		statements: number | null;
	};
}

const StatusBadge = ({
	status,
	label,
}: {
	status: 'success' | 'error' | 'warning';
	label: string;
}) => {
	const styles = {
		success: {
			backgroundColor: '#dcfce7',
			color: '#166534',
			icon: '✅',
		},
		error: {
			backgroundColor: '#fee2e2',
			color: '#991b1b',
			icon: '❌',
		},
		warning: {
			backgroundColor: '#fef3c7',
			color: '#92400e',
			icon: '⚠️',
		},
	};

	const { backgroundColor, color, icon } = styles[status];

	return (
		<span
			style={{
				padding: '0.25rem 0.75rem',
				borderRadius: '4px',
				fontSize: '0.875rem',
				fontWeight: 500,
				backgroundColor,
				color,
			}}
		>
			{icon} {label}
		</span>
	);
};

const MetricCard = ({
	title,
	value,
	subvalue,
}: {
	title: string;
	value: string | number;
	subvalue?: string;
}) => (
	<div
		style={{
			padding: '1.5rem',
			backgroundColor: '#f9fafb',
			border: '1px solid #e5e7eb',
			borderRadius: '8px',
		}}
	>
		<h3
			style={{
				margin: '0 0 0.5rem 0',
				fontSize: '0.875rem',
				fontWeight: 600,
				color: '#6b7280',
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
			}}
		>
			{title}
		</h3>
		<div style={{ fontSize: '1.875rem', fontWeight: 700, color: '#111827' }}>
			{value}
		</div>
		{subvalue && (
			<div
				style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}
			>
				{subvalue}
			</div>
		)}
	</div>
);

const formatDuration = (seconds: number): string => {
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}m ${secs}s`;
};

const formatPct = (value: number | null | undefined): string => {
	if (value === null || value === undefined || Number.isNaN(value)) return '–';
	return `${value.toFixed(1)}%`;
};

export const Summary = (props: SummaryProps) => {
	const typeCheckStatus =
		props.typeCheckErrors === 0
			? { status: 'success' as const, label: 'Type Check' }
			: {
					status: 'error' as const,
					label: `Type Check: ${props.typeCheckErrors} ${props.typeCheckErrors === 1 ? 'error' : 'errors'}`,
				};

	const lintStatus =
		props.lintErrors === 0
			? { status: 'success' as const, label: 'Lint' }
			: {
					status: 'error' as const,
					label: `Lint: ${props.lintErrors} ${props.lintErrors === 1 ? 'error' : 'errors'}`,
				};

	const testsTotal = props.test.passed + props.test.failed;
	const testStatus =
		testsTotal === 0
			? { status: 'error' as const, label: 'Tests: Failed to run' }
			: props.test.failed === 0
				? {
						status: 'success' as const,
						label: `Tests: ${props.test.passed} passed`,
					}
				: {
						status: 'error' as const,
						label: `Tests: ${props.test.failed} failed, ${props.test.passed} passed`,
					};

	const a11yStatus =
		props.test.passed === 0
			? {
					status: 'warning' as const,
					label: 'Accessibility: Inconclusive',
				}
			: props.a11y.violations === 0
				? { status: 'success' as const, label: 'Accessibility' }
				: {
						status: 'warning' as const,
						label:
							props.test.failed > 0
								? `Accessibility: ${props.a11y.violations} ${props.a11y.violations === 1 ? 'violation' : 'violations'} from ${props.test.passed}/${testsTotal} tests`
								: `Accessibility: ${props.a11y.violations} ${props.a11y.violations === 1 ? 'violation' : 'violations'}`,
					};

	return (
		<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
			<h1 style={{ marginTop: 0 }}>Evaluation Summary</h1>

			<div style={{ marginBottom: '2rem' }}>
				<h2
					style={{
						fontSize: '1.125rem',
						fontWeight: 600,
						marginBottom: '1rem',
					}}
				>
					Status
				</h2>
				<div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
					<StatusBadge
						status={props.buildSuccess ? 'success' : 'error'}
						label="Build"
					/>
					<StatusBadge
						status={typeCheckStatus.status}
						label={typeCheckStatus.label}
					/>
					<StatusBadge status={lintStatus.status} label={lintStatus.label} />
					<StatusBadge status={testStatus.status} label={testStatus.label} />
					<StatusBadge status={a11yStatus.status} label={a11yStatus.label} />
				</div>
			</div>

			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
					gap: '1rem',
				}}
			>
				<MetricCard title="Agent" value={props.agent} />
				<MetricCard title="Model" value={props.model} />
				<MetricCard
					title="Duration"
					value={formatDuration(props.duration)}
					subvalue={`API: ${formatDuration(props.durationApi)}`}
				/>
				<MetricCard
					title="Cost"
					value={`${props.cost ? `$${props.cost.toFixed(4)}` : 'unknown'}`}
				/>
				<MetricCard title="Turns" value={props.turns} />
				{props.coverage && (
					<MetricCard
						title="Coverage (lines)"
						value={formatPct(props.coverage.lines)}
						subvalue={`Statements ${formatPct(props.coverage.statements)}, Branches ${formatPct(props.coverage.branches)}`}
					/>
				)}
			</div>
		</div>
	);
};
