// @ts-nocheck
import { useMemo, useState } from 'react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { extractImportsFromContent } from '../../lib/graders/component-usage.ts';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('html', markup);

interface SourceProps {
	files: Record<string, string>;
}

interface DisplayImportInfo {
	line: string;
	source: string;
	specifiers: string[];
	file: string;
}

const getLanguageFromPath = (filePath: string): string => {
	const ext = filePath.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'ts':
		case 'tsx':
			return 'tsx';
		case 'js':
		case 'jsx':
			return 'javascript';
		case 'css':
			return 'css';
		case 'json':
			return 'json';
		case 'html':
			return 'html';
		case 'md':
		case 'mdx':
			return 'markdown';
		default:
			return 'typescript';
	}
};

const extractImports = (
	files: Record<string, string>,
): { imports: DisplayImportInfo[]; uniqueSpecifierCount: number } => {
	const imports: DisplayImportInfo[] = [];
	// Track unique source:specifier pairs for accurate counting
	const uniqueSpecifiers = new Set<string>();

	// Regex to match complete import statements (including multi-line) for extracting original line
	const importRegex = /import\s+[\s\S]*?from\s+['"]([^'"]+)['"];?/g;

	for (const [filePath, content] of Object.entries(files)) {
		// Use shared function for extraction (with identifier names for display, include all packages)
		const fileImports = extractImportsFromContent(content, {
			ignorePackages: false,
			defaultImportName: 'identifier',
		});

		// Also extract the original lines for display
		let match;
		let importIndex = 0;
		while ((match = importRegex.exec(content)) !== null) {
			const fullStatement = match[0];
			const source = match[1];

			// Skip relative imports (same as the shared function)
			if (!source || source.startsWith('.') || source.startsWith('/')) continue;

			// Find the matching import from our extracted imports
			if (
				importIndex < fileImports.length &&
				fileImports[importIndex]?.source === source
			) {
				const normalized = fullStatement.replace(/\s+/g, ' ').trim();
				imports.push({
					line: normalized,
					source,
					specifiers: fileImports[importIndex].specifiers,
					file: filePath,
				});
				// Add to unique set for accurate counting
				for (const specifier of fileImports[importIndex].specifiers) {
					uniqueSpecifiers.add(`${source}:${specifier}`);
				}
				importIndex++;
			}
		}
		// Reset regex lastIndex for next file
		importRegex.lastIndex = 0;
	}

	return { imports, uniqueSpecifierCount: uniqueSpecifiers.size };
};

const CodeBlock = ({
	content,
	language,
}: {
	content: string;
	language: string;
}) => (
	<div className="sb-unstyled">
		<SyntaxHighlighter
			language={language}
			style={oneDark}
			showLineNumbers
			customStyle={{
				margin: 0,
				borderRadius: 0,
				fontSize: '0.875rem',
			}}
		>
			{content}
		</SyntaxHighlighter>
	</div>
);

const MetadataCard = ({
	label,
	value,
}: {
	label: string;
	value: string | number;
}) => (
	<div
		style={{
			padding: '1rem 1.5rem',
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
				marginBottom: '0.25rem',
			}}
		>
			{label}
		</div>
		<div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
			{typeof value === 'number' ? value.toLocaleString() : value}
		</div>
	</div>
);

const ImportsSection = ({ imports }: { imports: DisplayImportInfo[] }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const { groupedBySource, uniqueSpecifierCount: totalUniqueSpecifiers } =
		useMemo(() => {
			const grouped: Record<string, DisplayImportInfo[]> = {};
			const uniqueSet = new Set<string>();
			for (const imp of imports) {
				const existing = grouped[imp.source];
				if (existing) {
					existing.push(imp);
				} else {
					grouped[imp.source] = [imp];
				}
				for (const specifier of imp.specifiers) {
					uniqueSet.add(`${imp.source}:${specifier}`);
				}
			}
			return {
				groupedBySource: Object.entries(grouped).sort(([a], [b]) =>
					a.localeCompare(b),
				),
				uniqueSpecifierCount: uniqueSet.size,
			};
		}, [imports]);

	if (imports.length === 0) return null;

	return (
		<div
			style={{
				marginBottom: '1.5rem',
				border: '1px solid #e5e7eb',
				borderRadius: '8px',
				overflow: 'hidden',
			}}
		>
			<div
				onClick={() => setIsExpanded(!isExpanded)}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.75rem',
					padding: '1rem',
					backgroundColor: '#f0fdf4',
					cursor: 'pointer',
					userSelect: 'none',
					borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
				}}
			>
				<div
					style={{
						transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
						transition: 'transform 0.2s',
						fontSize: '0.75rem',
					}}
				>
					▶
				</div>
				<span style={{ fontWeight: 600, color: '#166534' }}>
					External Imports
				</span>
				<span
					style={{
						fontSize: '0.875rem',
						color: '#6b7280',
					}}
				>
					{totalUniqueSpecifiers} unique specifiers from{' '}
					{groupedBySource.length} packages
				</span>
			</div>
			{isExpanded && (
				<div style={{ padding: '1rem', backgroundColor: 'white' }}>
					{groupedBySource.map(([source, sourceImports]) => (
						<div key={source} style={{ marginBottom: '1rem' }}>
							<div
								style={{
									fontWeight: 600,
									marginBottom: '0.5rem',
									color: '#1f2937',
								}}
							>
								<code
									style={{
										backgroundColor: '#dbeafe',
										padding: '0.125rem 0.5rem',
										borderRadius: '4px',
										fontSize: '0.875rem',
									}}
								>
									{source}
								</code>
								<span
									style={{
										marginLeft: '0.5rem',
										fontSize: '0.75rem',
										color: '#6b7280',
									}}
								>
									({new Set(sourceImports.flatMap((i) => i.specifiers)).size}{' '}
									unique imports)
								</span>
							</div>
							{sourceImports.map((imp, idx) => (
								<div
									key={idx}
									style={{
										marginLeft: '1rem',
										marginBottom: '0.25rem',
										fontSize: '0.875rem',
									}}
								>
									<code
										style={{
											fontFamily: 'monospace',
											color: '#374151',
											backgroundColor: '#f3f4f6',
											padding: '0.25rem 0.5rem',
											borderRadius: '4px',
											display: 'inline-block',
										}}
									>
										{imp.line}
									</code>
									<span
										style={{
											marginLeft: '0.5rem',
											fontSize: '0.75rem',
											color: '#9ca3af',
										}}
									>
										← {imp.file}
									</span>
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
};

const FileTab = ({
	filePath,
	isActive,
	onClick,
}: {
	filePath: string;
	isActive: boolean;
	onClick: () => void;
}) => {
	const fileName = filePath.split('/').pop() || filePath;

	return (
		<button
			onClick={onClick}
			style={{
				padding: '0.5rem 1rem',
				border: 'none',
				borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
				backgroundColor: isActive ? 'white' : '#f9fafb',
				color: isActive ? '#1f2937' : '#6b7280',
				fontWeight: isActive ? 600 : 400,
				cursor: 'pointer',
				fontSize: '0.875rem',
				fontFamily: 'monospace',
				whiteSpace: 'nowrap',
				transition: 'all 0.15s ease',
			}}
			title={filePath}
		>
			{fileName}
		</button>
	);
};

const FileContent = ({
	filePath,
	content,
}: {
	filePath: string;
	content: string;
}) => {
	const language = getLanguageFromPath(filePath);
	const lineCount = content.split('\n').length;

	return (
		<div>
			<div
				style={{
					display: 'flex',
					gap: '1rem',
					alignItems: 'center',
					padding: '0.75rem 1rem',
					backgroundColor: '#f9fafb',
					borderBottom: '1px solid #e5e7eb',
				}}
			>
				<code
					style={{
						fontFamily: 'monospace',
						fontSize: '0.875rem',
						color: '#374151',
					}}
				>
					{filePath}
				</code>
				<span style={{ flex: 1 }} />
				<span
					style={{
						fontSize: '0.75rem',
						color: '#6b7280',
						padding: '0.25rem 0.5rem',
						backgroundColor: '#e5e7eb',
						borderRadius: '4px',
					}}
				>
					{lineCount} lines
				</span>
				<span
					style={{
						fontSize: '0.75rem',
						color: '#6b7280',
						padding: '0.25rem 0.5rem',
						backgroundColor: '#dbeafe',
						borderRadius: '4px',
					}}
				>
					{language}
				</span>
			</div>
			<CodeBlock content={content} language={language} />
		</div>
	);
};

export const Source = ({ files }: SourceProps) => {
	const sortedPaths = useMemo(
		() => Object.keys(files).sort((a, b) => a.localeCompare(b)),
		[files],
	);
	const [activeTab, setActiveTab] = useState(sortedPaths[0] || '');

	const { imports, uniqueSpecifierCount } = useMemo(
		() => extractImports(files),
		[files],
	);

	const totalFiles = sortedPaths.length;
	const totalLines = Object.values(files).reduce(
		(sum, content) => sum + content.split('\n').length,
		0,
	);

	if (totalFiles === 0) {
		return (
			<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
				<h1 style={{ marginTop: 0 }}>Source Files</h1>
				<div
					style={{
						padding: '2rem',
						backgroundColor: '#f9fafb',
						border: '1px solid #e5e7eb',
						borderRadius: '8px',
						textAlign: 'center',
						color: '#6b7280',
					}}
				>
					No source files found
				</div>
			</div>
		);
	}

	return (
		<div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
			<h1 style={{ marginTop: 0 }}>Source Files</h1>

			<div
				style={{
					display: 'flex',
					gap: '1rem',
					marginBottom: '1.5rem',
					flexWrap: 'wrap',
				}}
			>
				<MetadataCard label="Files" value={totalFiles} />
				<MetadataCard label="Total Lines" value={totalLines} />
				<MetadataCard label="External Imports" value={uniqueSpecifierCount} />
			</div>

			<ImportsSection imports={imports} />

			<div
				style={{
					border: '1px solid #e5e7eb',
					borderRadius: '8px',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						display: 'flex',
						overflowX: 'auto',
						backgroundColor: '#f9fafb',
						borderBottom: '1px solid #e5e7eb',
					}}
				>
					{sortedPaths.map((filePath) => (
						<FileTab
							key={filePath}
							filePath={filePath}
							isActive={activeTab === filePath}
							onClick={() => setActiveTab(filePath)}
						/>
					))}
				</div>
				{activeTab && files[activeTab] && (
					<FileContent filePath={activeTab} content={files[activeTab]} />
				)}
			</div>
		</div>
	);
};
