import ts from 'typescript';
import * as path from 'node:path';

type DiagnosticError = {
  file: string;
  line: number;
  column: number;
  code: number;
  message: string;
  category: string;
} | {
  message: string;
  code: number;
};

type TypeCheckResults = {
  success: boolean;
  errors: DiagnosticError[];
  warnings: DiagnosticError[];
};

export function typeCheck(configPath: string): TypeCheckResults {
  // Read tsconfig.json
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  // Create program
  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options
  });

  // Get diagnostics
  const emitResult = program.emit();
  const allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  // Structure the output
  const results: TypeCheckResults = {
    success: allDiagnostics.length === 0,
    errors: [],
    warnings: []
  };

  allDiagnostics.forEach(diagnostic => {
    if (diagnostic.file && diagnostic.start) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start
      );
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n'
      );
      
      const error = {
        file: diagnostic.file.fileName,
        line: line + 1,
        column: character + 1,
        code: diagnostic.code,
        message: message,
        category: ts.DiagnosticCategory[diagnostic.category]
      };

      if (diagnostic.category === ts.DiagnosticCategory.Error) {
        results.errors.push(error);
      } else if (diagnostic.category === ts.DiagnosticCategory.Warning) {
        results.warnings.push(error);
      }
    } else {
      results.errors.push({
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        code: diagnostic.code
      });
    }
  });

  return results;
}
