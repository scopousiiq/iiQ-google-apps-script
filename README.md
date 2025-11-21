# IncidentIQ Google Apps Script Sync

A Google Apps Script that synchronizes ticket data from Incident IQ to Google Sheets, pulling ticket details and SLA information in bulk.

## Overview

This script connects to the Incident IQ API to:
- Fetch all tickets from a specified view
- Retrieve SLA data for all tickets in a single bulk operation
- Extract key ticket details (resolution time, closed date, assigned user, location, priority, issue, subject)
- Write formatted data to a Google Sheet

The script uses efficient pagination and bulk API calls to minimize API requests while handling large datasets.

## Features

- **Bulk SLA Fetching**: Uses `POST /api/v1.0/tickets/slas` to fetch SLA data for all tickets in one paginated call (not individual requests)
- **View Filtering**: Filters tickets by a saved view using the view facet filter
- **SLA Formatting**: Displays SLA target and actual resolution times in the format: `Sla: < 2 Days / Actual: 6.2 Days`
- **Pagination Support**: Handles large datasets with configurable page size
- **Debug Mode**: Optional debug logging to troubleshoot sync issues
- **Error Handling**: Validates configuration and reports errors before execution

## Prerequisites

1. **Google Sheets Access**: A Google Sheet where you want to write ticket data
2. **Incident IQ Account**: Access to Incident IQ API v1.0
3. **API Credentials**: 
   - Subdomain (from your Incident IQ tenant URL)
   - Site ID (GUID of your active site)
   - API Token (Bearer token with ticket/sla endpoint access)
4. **Sheet Configuration**: A "Config" sheet to define which tabs sync and their ticket type IDs and view IDs

## Installation in Google Sheets

### Step 1: Create or Open a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new sheet or open an existing one
3. Create a sheet tab named `Config` (this will store your sync configurations)
4. Create additional sheet tabs for each data source (e.g., `Devices/Hardware`, `Software Licenses`, etc.)

### Step 2: Open Apps Script Editor

1. In the Google Sheet, click **Extensions** → **Apps Script**
2. This opens the Google Apps Script editor in a new tab

### Step 3: Copy the Script

1. In the Apps Script editor, you should see a `Code.gs` file in the left panel (or create one if it doesn't exist)
2. Delete any default placeholder code
3. Copy the entire contents of `syncTicketViewWithSlas.gs` from this folder
4. Paste it into the `Code.gs` file in the Apps Script editor

### Step 4: Configure the Script

1. In the `Code.gs` file, locate the `INCIDENT_IQ_CONFIG` object near the top (lines 8-36)
2. Update the following properties with your Incident IQ credentials:
   - `subdomain`: Your Incident IQ subdomain (e.g., if your URL is `https://acme.incidentiq.com`, use `"acme"`)
   - `siteId`: Your Incident IQ site GUID
   - `apiToken`: Your Incident IQ API Bearer token

3. Optional: Configure these properties as needed:
   - `pageSize`: Records per API request (default: 1000, max: 1000)
   - `debugMode`: Set to `true` to enable console logging (default: false)
   - `debugLimit`: Max records to fetch when in debug mode (default: 100)
   - `configSheetName`: Name of the config sheet (default: `"Config"`)

### Step 5: Set Up the Config Sheet

1. In your Google Sheet, navigate to the `Config` tab (or the sheet you named in `configSheetName`)
2. Create a header row with these columns:
   - **Column A**: Sheet Name
   - **Column B**: Ticket Type ID
   - **Column C**: View ID
   - **Column D**: Start Row (optional, defaults to 2)
   - **Column E**: Start Column (optional, defaults to 5)

3. Add a row for each sheet you want to sync with its configuration:

| Sheet Name | Ticket Type ID | View ID | Start Row | Start Column |
|---|---|---|---|---|
| Devices/Hardware | d5d91f20-2269-e611-80f1-000c29ab80b0 | {view-guid-1} | 2 | 5 |
| Software Licenses | a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6 | {view-guid-2} | 2 | 5 |

   - **Sheet Name**: Must match an existing sheet tab in your workbook
   - **Ticket Type ID**: GUID of the ticket type to filter by (obtain from Incident IQ)
   - **View ID**: GUID of the view containing tickets to sync
   - **Start Row/Column**: Where to begin writing data (optional; uses defaults if blank)

### Step 6: Save the Script

Click **File** → **Save** (or use Ctrl+S / Cmd+S) and give your project a name (e.g., "IncidentIQ Sync")

## Usage

### Running the Script Manually

1. In the Apps Script editor, locate the `syncAllConfiguredSheets` function in the code
2. Click the **▶ Run** button (play icon) at the top
3. When prompted, grant authorization for the script to access your spreadsheet
4. The script will execute and read configurations from the `Config` sheet, then sync each configured sheet in sequence

**Note**: If a sheet sync fails, the script will log the error and continue with the next sheet. Check the logs for details.

### Running on a Schedule (Optional Time-Based Trigger)

1. In the Apps Script editor, click **Triggers** (clock icon on the left)
2. Click **+ Create new trigger**
3. Configure the trigger:
   - **Choose which function to run**: `syncAllConfiguredSheets`
   - **Which runs at deployment**: `Head`
   - **Select event source**: `Time-driven`
   - **Select type of time interval**: Choose your preferred interval (e.g., "Daily", "Every 6 hours")
   - **Select day and time** (if daily): Choose the time to run
4. Click **Save**

Now the script will run automatically on your schedule, syncing all configured sheets.

### Monitoring Execution with Debug Mode

1. Set `debugMode: true` in the `INCIDENT_IQ_CONFIG` object
2. Optionally set `debugLimit: 10` to test with fewer records
3. Run the script manually
4. Click **View** → **Logs** in the Apps Script editor
5. Review the console output to see detailed progress:
   - Ticket fetch progress (pages retrieved)
   - SLA fetch progress
   - Row building status
   - Data write completion

This is helpful for:
- Troubleshooting configuration issues
- Understanding API response structure for debugging
- Testing with a small dataset before running full sync

## Output Format

The script writes 7 columns to the spreadsheet (starting at column E by default):

| Column | Description | Example |
|--------|-------------|---------|
| Resolution Time | SLA target + actual resolution time | `Sla: < 2 Days / Actual: 6.2 Days` |
| Closed Date | Date/time ticket was closed | `2024-11-20 14:30` |
| Assigned To | User the ticket is assigned to | `John Smith` |
| Location | Ticket location | `Building A, Floor 3` |
| Priority | Ticket priority level | `High` |
| Issue | Issue category name | `Hardware Failure` |
| Ticket Label | Ticket subject/title | `Laptop not powering on` |

## API Endpoints Used

The script uses two key Incident IQ API endpoints:

### 1. Fetch Tickets from View
```
POST /api/v1.0/tickets?$p={pageIndex}&$s={pageSize}&$o=TicketClosedDate ASC
```
- Filters tickets by view facet
- Supports pagination with `$p` (page index) and `$s` (page size)
- Sorted by closed date ascending

### 2. Fetch SLA Data (Bulk)
```
POST /api/v1.0/tickets/slas?$p={pageIndex}&$s={pageSize}&$o=TicketClosedDate ASC
```
- Fetches SLA data for multiple tickets in one request using `TicketNumber` facet filters
- More efficient than individual SLA lookups per ticket
- Supports pagination for large datasets

## Troubleshooting

### "Config sheet not found" Error
- Verify that a sheet tab named `Config` exists in your spreadsheet
- Or update the `configSheetName` property in `INCIDENT_IQ_CONFIG` to match your actual config sheet name

### "Configure INCIDENT_IQ_CONFIG" Error
- One or more required API config values are missing:
  - `subdomain`
  - `siteId`
  - `apiToken`
- Check that all three values are filled in (non-empty strings)

### "Ticket Type ID is required" or "View ID is required" Error
- A row in the Config sheet is missing the required Ticket Type ID or View ID
- Check row number in the error message
- Add the missing values to that row

### "Sheet 'X' was not found" Error
- One of the sheets listed in your Config sheet doesn't exist in the workbook
- Create the missing sheet or update the Config sheet to reference an existing sheet name
- Sheet names are case-sensitive

## Configuration Reference

### INCIDENT_IQ_CONFIG Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `subdomain` | string | `""` | Subdomain of your Incident IQ tenant URL |
| `siteId` | string | `""` | GUID of your active Incident IQ site |
| `apiToken` | string | `""` | Bearer token for API authentication |
| `pageSize` | number | `1000` | Records per API request (1-1000) |
| `debugMode` | boolean | `false` | Enable/disable console logging |
| `debugLimit` | number | `100` | Max records to fetch in debug mode |
| `configSheetName` | string | `"Config"` | Name of the sheet containing sync configurations |

### Config Sheet Format

The `Config` sheet should have the following columns:

| Column | Name | Required | Description | Example |
|--------|------|----------|-------------|---------|
| A | Sheet Name | Yes | Name of the target sheet tab | `Devices/Hardware` |
| B | Ticket Type ID | Yes | GUID of the ticket type filter | `d5d91f20-2269-e611-80f1-000c29ab80b0` |
| C | View ID | Yes | GUID of the view to sync | `12345678-abcd-ef01-2345-6789abcdef01` |
| D | Start Row | No | Row to begin writing (default: 2) | `2` |
| E | Start Column | No | Column to begin writing (default: 5 for E) | `5` |

**Notes**:
- The first row should be a header row (will be skipped during processing)
- Empty rows in the Config sheet are skipped
- All rows must have at least Sheet Name, Ticket Type ID, and View ID
- Start Row and Start Column default to 2 and 5 respectively if not provided

## Performance Notes

- **Bulk SLA API**: This script uses the efficient bulk SLA endpoint instead of individual lookups, reducing API calls from N (number of tickets) to ~1 call per page
- **Pagination**: Both endpoints support pagination with configurable `pageSize` (default 1000)
- **API Throttling**: Light delays (250ms for tickets, 200ms for SLAs) prevent API rate limiting
- **Deduplication**: SLA responses are deduplicated across pages to avoid duplicate data

## License

This script is provided as-is for use with Incident IQ integrations.

## Support

For issues with:
- **Script Logic**: Review the debug logs (enable `debugMode: true`)
- **API Issues**: Check the Incident IQ API documentation or support
- **Google Sheets**: Consult Google Apps Script documentation
