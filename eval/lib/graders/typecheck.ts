import ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { GradingSummary, TrialArgs } from '../../types';

type DiagnosticError =
	| {
			file: string;
			line: number;
			column: number;
			code: number;
			message: string;
			category: string;
	  }
	| {
			message: string;
			code: number;
	  };

type TypeCheckResults = {
	success: boolean;
	errors: DiagnosticError[];
	warnings: DiagnosticError[];
};

export async function checkTypes({
	projectPath,
	resultsPath,
}: TrialArgs): Promise<GradingSummary['typeCheckErrors']> {
	// Read tsconfig.json
	const configFile = ts.readConfigFile(
		path.join(projectPath, 'tsconfig.app.json'),
		ts.sys.readFile,
	);
	const parsedConfig = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		projectPath,
	);

	// Create program
	const program = ts.createProgram({
		rootNames: parsedConfig.fileNames,
		options: parsedConfig.options,
	});

	// Get diagnostics
	const emitResult = program.emit();
	const allDiagnostics = ts
		.getPreEmitDiagnostics(program)
		.concat(emitResult.diagnostics);

	// Structure the output
	const result: TypeCheckResults = {
		success: allDiagnostics.length === 0,
		errors: [],
		warnings: [],
	};

	allDiagnostics.forEach((diagnostic) => {
		if (diagnostic.file && diagnostic.start) {
			const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
				diagnostic.start,
			);
			const message = ts.flattenDiagnosticMessageText(
				diagnostic.messageText,
				'\n',
			);

			const error = {
				file: diagnostic.file.fileName,
				line: line + 1,
				column: character + 1,
				code: diagnostic.code,
				message: message,
				category: ts.DiagnosticCategory[diagnostic.category],
			};

			if (diagnostic.category === ts.DiagnosticCategory.Error) {
				result.errors.push(error);
			} else if (diagnostic.category === ts.DiagnosticCategory.Warning) {
				result.warnings.push(error);
			}
		} else {
			result.errors.push({
				message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
				code: diagnostic.code,
			});
		}
	});
	await fs.writeFile(
		path.join(resultsPath, 'typecheck.json'),
		JSON.stringify(result, null, 2),
	);

	return result.errors.length;
}

/**
 * This allows running the type checker directly from the command line for testing.
 * use it like:
 * node ./lib/graders/typecheck.ts <relative_path_to_trial>
 */
if (import.meta.main) {
	const trialPath = process.argv.slice(2);
	if (!trialPath || trialPath.length === 0) {
		console.error('You must pass the path to the trial as an argument.');
		process.exit(1);
	}
	console.log({
		typeErrors: await checkTypes({
			projectPath: path.join(trialPath[0]!, 'project'),
			resultsPath: path.join(trialPath[0]!, 'results'),
		} as TrialArgs),
	});
}
