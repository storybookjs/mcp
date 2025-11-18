interface LintFile {
	filePath: string;
	errorCount: number;
	warningCount: number;
	messages: LintMessage[];
}

interface LintMessage {
	ruleId: string | null;
	severity: number;
	message: string;
	line: number;
	column: number;
}

interface LintProps {
	success: boolean;
	errorCount: number;
	warningCount: number;
	fixableErrorCount: number;
	fixableWarningCount: number;
	files: LintFile[];
}

const LintMessageItem = ({
	message,
	filePath,
}: {
	message: LintMessage;
	filePath: string;
}) => (
	<div
		style={{
			padding: '0.75rem',
			backgroundColor: message.severity === 2 ? '#fef2f2' : '#fffbeb',
			border: `1px solid ${message.severity === 2 ? '#fecaca' : '#fde68a'}`,
			borderRadius: '4px',
			marginBottom: '0.5rem',
		}}
	>
		<div
			style={{
				fontFamily: 'monospace',
				fontSize: '0.75rem',
				color: message.severity === 2 ? '#991b1b' : '#92400e',
				marginBottom: '0.25rem',
			}}
		>
			{filePath}:{message.line}:{message.column}
		</div>
		<div
			style={{
				color: '#1f2937',
				fontSize: '0.875rem',
				marginBottom: '0.25rem',
			}}
		>
			{message.message}
		</div>
		{message.ruleId && (
			<div
				style={{
					fontSize: '0.75rem',
					color: '#6b7280',
				}}
			>
				{message.ruleId}
			</div>
		)}
	</div>
);

const LintFileSection = ({ file }: { file: LintFile }) => (
	<div style={{ marginBottom: '1.5rem' }}>
		<h3
			style={{
				fontSize: '1rem',
				fontWeight: 600,
				marginBottom: '0.75rem',
				fontFamily: 'monospace',
				color: '#374151',
			}}
		>
			{file.filePath}
			<span style={{ color: '#6b7280', fontWeight: 400, marginLeft: '0.5rem' }}>
				({file.errorCount} errors, {file.warningCount} warnings)
			</span>
		</h3>
		{file.messages.map((message, index) => (
			<LintMessageItem key={index} message={message} filePath={file.filePath} />
		))}
	</div>
);

export const Lint = (props: LintProps) => {
	if (props.success && props.errorCount === 0 && props.warningCount === 0) {
		return (
			<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
				<h1 style={{ marginTop: 0 }}>Lint Results</h1>
				<div
					style={{
						padding: '2rem',
						backgroundColor: '#dcfce7',
						border: '1px solid #86efac',
						borderRadius: '8px',
						textAlign: 'center',
						fontSize: '1.125rem',
						color: '#166534',
					}}
				>
					✅ No lint errors or warnings found
				</div>
			</div>
		);
	}

	const errorFiles = props.files.filter((f) => f.errorCount > 0);
	const warningOnlyFiles = props.files.filter(
		(f) => f.errorCount === 0 && f.warningCount > 0,
	);

	return (
		<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
			<h1 style={{ marginTop: 0 }}>Lint Results</h1>

			<div
				style={{
					padding: '1rem',
					backgroundColor: '#f9fafb',
					border: '1px solid #e5e7eb',
					borderRadius: '8px',
					marginBottom: '2rem',
				}}
			>
				<div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
					<div>
						<span style={{ fontWeight: 600, color: '#991b1b' }}>
							{props.errorCount}
						</span>{' '}
						<span style={{ color: '#6b7280' }}>
							errors ({props.fixableErrorCount} fixable)
						</span>
					</div>
					<div>
						<span style={{ fontWeight: 600, color: '#92400e' }}>
							{props.warningCount}
						</span>{' '}
						<span style={{ color: '#6b7280' }}>
							warnings ({props.fixableWarningCount} fixable)
						</span>
					</div>
				</div>
			</div>

			{errorFiles.length > 0 && (
				<div style={{ marginBottom: '2rem' }}>
					<h2
						style={{
							fontSize: '1.125rem',
							fontWeight: 600,
							marginBottom: '1rem',
							color: '#991b1b',
						}}
					>
						Files with Errors
					</h2>
					{errorFiles.map((file, index) => (
						<LintFileSection key={index} file={file} />
					))}
				</div>
			)}

			{warningOnlyFiles.length > 0 && (
				<div>
					<h2
						style={{
							fontSize: '1.125rem',
							fontWeight: 600,
							marginBottom: '1rem',
							color: '#92400e',
						}}
					>
						Files with Warnings Only
					</h2>
					{warningOnlyFiles.map((file, index) => (
						<LintFileSection key={index} file={file} />
					))}
				</div>
			)}
		</div>
	);
};
