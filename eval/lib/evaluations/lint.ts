import { ESLint } from 'eslint';
import type { ExperimentArgs } from '../../types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function runESLint({projectPath, resultsPath}: ExperimentArgs) {
  // Create ESLint instance
  const eslint = new ESLint({
    cwd: projectPath,
  });

  // Lint files
  const results = await eslint.lintFiles(['./src/**/*.{js,ts,jsx,tsx}']);

  // Get formatter
  const formatter = await eslint.loadFormatter('stylish');
  const formatted = (formatter as any).format(results);

  // Structure the output
  const structured = {
    success: results.every(r => r.errorCount === 0),
    errorCount: results.reduce((sum, r) => sum + r.errorCount, 0),
    warningCount: results.reduce((sum, r) => sum + r.warningCount, 0),
    fixableErrorCount: results.reduce((sum, r) => sum + r.fixableErrorCount, 0),
    fixableWarningCount: results.reduce((sum, r) => sum + r.fixableWarningCount, 0),
    files: results.map(result => ({
      filePath: result.filePath,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      fixableErrorCount: result.fixableErrorCount,
      fixableWarningCount: result.fixableWarningCount,
      messages: result.messages.map(msg => ({
        ruleId: msg.ruleId,
        severity: msg.severity === 2 ? 'error' : 'warning',
        message: msg.message,
        messageId: msg.messageId,
        line: msg.line,
        column: msg.column,
        endLine: msg.endLine,
        endColumn: msg.endColumn,
        fix: msg.fix ? {
          range: msg.fix.range,
          text: msg.fix.text
        } : null
      }))
    })).filter(f => f.messages.length > 0)
  };

  await fs.writeFile(path.join(resultsPath, 'lint.json'), JSON.stringify(structured, null, 2));
  await fs.writeFile(path.join(resultsPath, 'lint.txt'), formatted);
  
  return structured.success;
}
