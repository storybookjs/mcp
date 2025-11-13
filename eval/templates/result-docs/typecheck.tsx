interface TypeCheckError {
	file: string;
	line: number;
	column: number;
	message: string;
	code: number;
}

interface TypeCheckProps {
	success: boolean;
	errors: TypeCheckError[];
	warnings: TypeCheckError[];
}

const DiagnosticItem = ({ diagnostic }: { diagnostic: TypeCheckError }) => (
	<div
		style={{
			padding: '1rem',
			backgroundColor: '#fef2f2',
			border: '1px solid #fecaca',
			borderRadius: '6px',
			marginBottom: '0.75rem',
		}}
	>
		<div
			style={{
				fontFamily: 'monospace',
				fontSize: '0.875rem',
				color: '#991b1b',
				marginBottom: '0.5rem',
			}}
		>
			{diagnostic.file}:{diagnostic.line}:{diagnostic.column}
		</div>
		<div style={{ color: '#1f2937', marginBottom: '0.25rem' }}>
			{diagnostic.message}
		</div>
		<div
			style={{
				fontSize: '0.75rem',
				color: '#6b7280',
			}}
		>
			TS{diagnostic.code}
		</div>
	</div>
);

export const TypeCheck = (props: TypeCheckProps) => {
	if (
		props.success &&
		props.errors.length === 0 &&
		props.warnings.length === 0
	) {
		return (
			<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
				<h1 style={{ marginTop: 0 }}>Type Check Results</h1>
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
					✅ No type errors found
				</div>
			</div>
		);
	}

	return (
		<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
			<h1 style={{ marginTop: 0 }}>Type Check Results</h1>

			{props.errors.length > 0 && (
				<div style={{ marginBottom: '2rem' }}>
					<h2
						style={{
							fontSize: '1.125rem',
							fontWeight: 600,
							marginBottom: '1rem',
							color: '#991b1b',
						}}
					>
						Errors ({props.errors.length})
					</h2>
					{props.errors.map((error, index) => (
						<DiagnosticItem key={index} diagnostic={error} />
					))}
				</div>
			)}

			{props.warnings.length > 0 && (
				<div>
					<h2
						style={{
							fontSize: '1.125rem',
							fontWeight: 600,
							marginBottom: '1rem',
							color: '#92400e',
						}}
					>
						Warnings ({props.warnings.length})
					</h2>
					{props.warnings.map((warning, index) => (
						<DiagnosticItem key={index} diagnostic={warning} />
					))}
				</div>
			)}
		</div>
	);
};
