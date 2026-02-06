// @ts-nocheck
import React from 'react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import { dark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { CoverageSummary } from '../../lib/evaluations/result-types';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);

interface CoverageFileData extends CoverageSummary {
	lineHits?: Record<string, number>;
	branchesByLine?: Record<string, { covered: number | null; total: number | null }>;
	source?: string;
}

interface CoverageProps {
	total: CoverageSummary;
	files?: Record<string, CoverageFileData>;
}

const formatPct = (value: number | null | undefined) => {
	if (value === null || value === undefined || Number.isNaN(value)) return '–';
	return `${value.toFixed(1)}%`;
};

const thStyle: React.CSSProperties = {
	textAlign: 'left',
	padding: '0.5rem 0.75rem',
	borderBottom: '1px solid #e5e7eb',
	color: '#374151',
	fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
	padding: '0.5rem 0.75rem',
	borderBottom: '1px solid #f3f4f6',
	color: '#1f2937',
};

export const Coverage = ({ total, files }: CoverageProps) => {
	const fileEntries = files ? Object.entries(files) : [];
	const [expandedFile, setExpandedFile] = React.useState<string | null>(null);

	return (
		<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
			<h1 style={{ marginTop: 0 }}>Coverage</h1>

			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
					gap: '1rem',
					marginBottom: '2rem',
				}}
			>
				<Metric label="Lines" value={formatPct(total.lines?.pct)} />
				<Metric label="Statements" value={formatPct(total.statements?.pct)} />
				<Metric label="Branches" value={formatPct(total.branches?.pct)} />
				<Metric label="Functions" value={formatPct(total.functions?.pct)} />
			</div>

			{fileEntries.length > 0 && (
				<div>
					<h2 style={{ marginBottom: '0.75rem' }}>By File</h2>
					<table
						style={{
							width: '100%',
							borderCollapse: 'collapse',
							fontSize: '0.95rem',
						}}
					>
						<thead>
							<tr>
								<th style={thStyle}>File</th>
								<th style={thStyle}>Lines</th>
								<th style={thStyle}>Statements</th>
								<th style={thStyle}>Branches</th>
								<th style={thStyle}>Functions</th>
							</tr>
						</thead>
						<tbody>
							{fileEntries.map(([filePath, data]) => (
								<React.Fragment key={filePath}>
									<tr
										style={{ cursor: data.source ? 'pointer' : 'default' }}
										onClick={() =>
											data.source
												? setExpandedFile(expandedFile === filePath ? null : filePath)
												: undefined
										}
									>
										<td style={tdStyle}>
											<code>{filePath}</code>
											{data.source && (
												<span style={{ marginLeft: '0.5rem', color: '#6b7280' }}>
													{expandedFile === filePath ? '▼' : '►'}
												</span>
											)}
										</td>
										<td style={tdStyle}>{formatPct(data.lines?.pct)}</td>
										<td style={tdStyle}>{formatPct(data.statements?.pct)}</td>
										<td style={tdStyle}>{formatPct(data.branches?.pct)}</td>
										<td style={tdStyle}>{formatPct(data.functions?.pct)}</td>
									</tr>
									{expandedFile === filePath && data.source && (
										<tr>
											<td colSpan={5} style={{ padding: 0 }}>
												<FileCoverageView data={data} />
											</td>
										</tr>
									)}
								</React.Fragment>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
};

const FileCoverageView = ({ data }: { data: CoverageFileData }) => {
	const lineHits = data.lineHits || {};
	const branches = data.branchesByLine || {};

	const lineProps = (lineNumber: number) => {
		const lineKey = lineNumber.toString();
		const hits = lineHits[lineKey];
		const branchInfo = branches[lineKey];
		const covered = hits !== undefined ? hits > 0 : undefined;
		const branchCovered =
			branchInfo && branchInfo.total && branchInfo.total > 0
				? (branchInfo.covered ?? 0) >= branchInfo.total
				: undefined;

		const borderLeft =
			branchCovered === undefined
				? covered === undefined
					? '4px solid rgba(255, 255, 255, 0.1)'
					: covered
						? '4px solid #96ff9d'
						: '4px solid #ff6363'
				: branchCovered
					? '4px solid #22c55e'
					: '4px solid #f59e0b';

		return {
			style: {
				borderLeft,
				display: 'block',
				paddingLeft: '0.35rem',
			},
		};
	};

	return (
		<SyntaxHighlighter language="tsx" style={dark} showLineNumbers wrapLines lineProps={lineProps}>
			{data.source || ''}
		</SyntaxHighlighter>
	);
};

const Metric = ({ label, value }: { label: string; value: string | number }) => (
	<div
		style={{
			padding: '1.25rem',
			border: '1px solid #e5e7eb',
			borderRadius: '8px',
			background: '#f9fafb',
		}}
	>
		<div
			style={{
				fontSize: '0.85rem',
				color: '#6b7280',
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
				marginBottom: '0.35rem',
				fontWeight: 600,
			}}
		>
			{label}
		</div>
		<div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#111827' }}>{value}</div>
	</div>
);
