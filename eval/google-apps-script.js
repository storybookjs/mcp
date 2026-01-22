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
 * This script accepts any JSON object and appends it as a row.
 * The first POST request will create headers from the JSON keys.
 * You can manually edit the headers in the sheet if needed.
 */

// oxlint-disable-next-line no-unused-vars
function doPost(e) {
	try {
		// Parse the incoming JSON data
		const data = JSON.parse(e.postData.contents);

		// Get the active spreadsheet and the first sheet
		const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

		// Get the keys from the incoming data (in order)
		const keys = Object.keys(data);

		// Check if headers exist
		const firstHeaderCell = sheet.getRange(1, 1).getValue();
		if (firstHeaderCell === '') {
			// No headers yet, create them from the JSON keys
			const headers = keys.map((key) => {
				// Convert camelCase to Title Case with spaces
				return key
					.replace(/([A-Z])/g, ' $1')
					.replace(/^./, (str) => str.toUpperCase())
					.trim();
			});
			sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
			sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
		}

		// Prepare the row data in the same order as keys
		const rowData = keys.map((key) => {
			const value = data[key];
			// Handle different data types
			if (typeof value === 'boolean') {
				return value ? 'TRUE' : 'FALSE';
			}
			if (value === null || value === undefined) {
				return '';
			}
			return value;
		});

		// Append the row to the sheet
		const lastRow = sheet.getLastRow();
		const targetRow = lastRow < 1 ? 2 : lastRow + 1;
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
		sheet.autoResizeColumns(1, rowData.length);

		return ContentService.createTextOutput(
			JSON.stringify({
				success: true,
				message: 'Data appended successfully',
				row: targetRow,
			}),
		).setMimeType(ContentService.MimeType.JSON);
	} catch (error) {
		return ContentService.createTextOutput(
			JSON.stringify({
				success: false,
				error: error.toString(),
			}),
		).setMimeType(ContentService.MimeType.JSON);
	}
}
