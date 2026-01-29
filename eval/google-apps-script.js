/**
 * Google Apps Script for Storybook MCP Evaluations
 *
 * Instructions:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Replace the contents with this code
 * 4. Click "Deploy" > "New deployment"
 * 5. Select type: "Web app"
 * 6. Execute as: "Me"
 * 7. Who has access: "Anyone"
 * 8. Click "Deploy" and copy the web app URL
 * 9. Use that URL in your evaluation script
 *
 * Authorization:
 * This script requires Drive access to find uploadId sheets.
 * Run authorize() from the editor to trigger the authorization prompt.
 * Click "Review Permissions" → Select account → "Advanced" → "Go to [project] (unsafe)" → "Allow"
 *
 * This script accepts any JSON object and appends it as a row.
 * The first POST request will create headers from the JSON keys.
 * You can manually edit the headers in the sheet if needed.
 *
 * After writing to the main sheet, this script also copies the row to
 * the uploadId sheet named "{uploadId} - Storybook MCP Eval Results".
 */

/**
 * Converts a camelCase key to Title Case with spaces.
 */
function toTitleCase(key) {
	return key
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (str) => str.toUpperCase())
		.trim();
}

/**
 * Ensures headers exist in the sheet. Creates them from keys if missing.
 */
function ensureHeaders(sheet, keys) {
	const firstHeaderCell = sheet.getRange(1, 1).getValue();
	if (firstHeaderCell === '') {
		const headers = keys.map(toTitleCase);
		sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
		sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
		console.log('Created headers:', headers.join(', '));
	}
}

/**
 * Appends a row to the sheet with formatting (chromaticUrl hyperlink).
 * Uses LockService to prevent race conditions with concurrent writes.
 * Returns the row number where data was appended.
 */
function appendRow(sheet, keys, rowData, data) {
	const lock = LockService.getScriptLock();
	const sheetName = sheet.getName();
	console.log('Waiting to acquire lock for sheet:', sheetName);

	try {
		lock.waitLock(120000); // Wait up to 120 seconds for the lock
		console.log('Lock acquired for sheet:', sheetName);

		const lastRow = sheet.getLastRow();
		const targetRow = lastRow < 1 ? 2 : lastRow + 1;
		console.log('Writing to row', targetRow, '(lastRow was', lastRow + ')');

		sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

		// Handle chromaticUrl as a hyperlink
		const chromaticUrlIndex = keys.indexOf('chromaticUrl');
		if (chromaticUrlIndex !== -1) {
			const cell = sheet.getRange(targetRow, chromaticUrlIndex + 1);
			if (data.chromaticUrl !== '') {
				cell.setFormula(`=HYPERLINK("${data.chromaticUrl}", "See results")`);
			} else {
				cell.setValue('no result');
			}
		}

		SpreadsheetApp.flush(); // Force all pending changes to be written
		console.log('Flushed changes, releasing lock for sheet:', sheetName);
		return targetRow;
	} finally {
		lock.releaseLock();
		console.log('Lock released for sheet:', sheetName);
	}
}

/**
 * Converts data values to sheet-compatible format.
 */
function prepareRowData(keys, data) {
	return keys.map((key) => {
		const value = data[key];
		if (typeof value === 'boolean') {
			return value ? 'TRUE' : 'FALSE';
		}
		if (value === null || value === undefined) {
			return '';
		}
		return value;
	});
}

// oxlint-disable-next-line no-unused-vars
function doPost(e) {
	try {
		const data = JSON.parse(e.postData.contents);
		console.log('Received POST request with data:', JSON.stringify(data));

		const mainSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
		const sheet = mainSpreadsheet.getActiveSheet();

		console.log(
			'Writing to main spreadsheet:',
			mainSpreadsheet.getName(),
			'Sheet:',
			sheet.getName(),
		);

		const keys = Object.keys(data);
		const rowData = prepareRowData(keys, data);

		ensureHeaders(sheet, keys);
		const targetRow = appendRow(sheet, keys, rowData, data);
		console.log('Appended row', targetRow, 'with', rowData.length, 'columns');

		if (data.uploadId) {
			copyToUploadIdSheet(mainSpreadsheet, data.uploadId, keys, rowData, data);
		} else {
			console.log('No uploadId in data, skipping uploadId sheet copy');
		}

		return ContentService.createTextOutput(
			JSON.stringify({
				success: true,
				message: 'Data appended successfully',
				row: targetRow,
			}),
		).setMimeType(ContentService.MimeType.JSON);
	} catch (error) {
		console.error('Error in doPost:', error.toString(), error.stack);
		return ContentService.createTextOutput(
			JSON.stringify({
				success: false,
				error: error.toString(),
			}),
		).setMimeType(ContentService.MimeType.JSON);
	}
}

/**
 * Copies the row data to the uploadId spreadsheet named "{uploadId} - Storybook MCP Eval Results"
 * in the same directory as the main spreadsheet.
 */
function copyToUploadIdSheet(mainSpreadsheet, uploadId, keys, rowData, data) {
	const targetFileName = uploadId + ' - Storybook MCP Eval Results';
	console.log('Looking for uploadId sheet:', targetFileName);

	const mainFile = DriveApp.getFileById(mainSpreadsheet.getId());
	const parentDirectories = mainFile.getParents();

	if (!parentDirectories.hasNext()) {
		throw new Error('Main spreadsheet is not in a directory');
	}

	const directory = parentDirectories.next();
	console.log('Searching in directory:', directory.getName());

	const files = directory.getFilesByName(targetFileName);
	if (!files.hasNext()) {
		throw new Error('Upload ID sheet not found: ' + targetFileName);
	}

	const uploadIdFile = files.next();
	console.log('Found uploadId file:', uploadIdFile.getName());

	const uploadIdSpreadsheet = SpreadsheetApp.openById(uploadIdFile.getId());
	const uploadIdSheet = uploadIdSpreadsheet.getSheets()[0];

	if (!uploadIdSheet) {
		throw new Error('No sheets in uploadId spreadsheet');
	}

	console.log('Writing to uploadId sheet:', uploadIdSheet.getName());

	const targetRow = appendRow(uploadIdSheet, keys, rowData, data);
	console.log(
		'Appended row',
		targetRow,
		'to uploadId sheet with',
		rowData.length,
		'columns',
	);
}

/**
 * Debug function to test doPost() from the Apps Script editor.
 * Run this function directly to simulate a POST request with sample data.
 */
// oxlint-disable-next-line no-unused-vars
function debugPost() {
	const sampleData = {
		uploadId: 'debug-script',
		runId: 'run-001',
		timestamp: new Date().toISOString().replace('Z', ''),
		evalName: '111-create-component-atom-reshaped',
		label: '2. With Storybook MCP Docs',
		chromaticUrl: 'https://www.example.com/',
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		testsPassed: 1,
		a11yViolations: 0,
		coverageLines: 0.85,
		cost: 0.05,
		duration: 120000,
		turns: 5,
		contextType: 'storybook-mcp-docs',
		agent: 'claude-code',
		gitBranch: 'main',
		gitCommit: 'abc1234',
		experimentPath: 'eval/experiments/test',
	};

	const mockEvent = {
		postData: {
			contents: JSON.stringify(sampleData),
		},
	};

	const result = doPost(mockEvent);
	console.log('Result:', result.getContent());
}

/**
 * Run this function first to trigger the authorization dialog for Drive access.
 * This is needed because doPost catches errors, preventing the auth dialog from appearing.
 */
// oxlint-disable-next-line no-unused-vars
function authorize() {
	// This call will trigger the authorization dialog if not already authorized
	const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	const file = DriveApp.getFileById(spreadsheet.getId());
	console.log('Authorized! File:', file.getName());
	console.log('You can now run debugPost() or use the web app.');
}
