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
   - API Token (Bearer token with ticket/sla endpoint access)◊
   - View ID (GUID of a saved ticket view to sync)

## Installation in Google Sheets

### Step 1: Create or Open a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new sheet or open an existing one
3. Ensure you have a sheet tab named `Devices/Hardware` (or update the `sheetName` config to match your tab)

### Step 2: Open Apps Script Editor

1. In the Google Sheet, click **Extensions** → **Apps Script**
2. This opens the Google Apps Script editor in a new tab

### Step 3: Copy the Script

1. In the Apps Script editor, you should see a `Code.gs` file in the left panel (or create one if it doesn't exist)
2. Delete any default placeholder code
3. Copy the entire contents of `incidentiq-google-apps-script.gs` from this folder
4. Paste it into the `Code.gs` file in the Apps Script editor

### Step 4: Configure the Script

1. In the `Code.gs` file, locate the `INCIDENT_IQ_CONFIG` object near the top (lines 8-42)
2. Update the following properties with your Incident IQ credentials:
   - `subdomain`: Your Incident IQ subdomain (e.g., if your URL is `https://acme.incidentiq.com`, use `"acme"`)
   - `siteId`: Your Incident IQ site GUID
   - `apiToken`: Your Incident IQ API Bearer token
   - `viewId`: The GUID of the view you want to sync

3. Optional: Configure these properties as needed:
   - `startRow`: Which row to start writing data (default: 2)
   - `startColumn`: Which column to start writing (default: 5 for column E)
   - `sheetName`: Name of the sheet tab (default: `"Devices/Hardware"`)
   - `pageSize`: Records per API request (default: 1000, max: 1000)
   - `debugMode`: Set to `true` to enable console logging (default: false)
   - `debugLimit`: Max records to fetch when in debug mode (default: 100)

### Step 5: Save the Script

Click **File** → **Save** (or use Ctrl+S / Cmd+S) and give your project a name (e.g., "IncidentIQ Sync")

## Usage

### Running the Script Manually

1. In the Apps Script editor, locate the `syncIncidentIqTickets` function in the code
2. Click the **▶ Run** button (play icon) at the top
3. When prompted, grant authorization for the script to access your spreadsheet
4. The script will execute and write data to your sheet

### Running on a Schedule (Optional Time-Based Trigger)

1. In the Apps Script editor, click **Triggers** (clock icon on the left)
2. Click **+ Create new trigger**
3. Configure the trigger:
   - **Choose which function to run**: `syncIncidentIqTickets`
   - **Which runs at deployment**: `Head`
   - **Select event source**: `Time-driven`
   - **Select type of time interval**: Choose your preferred interval (e.g., "Daily", "Every 6 hours")
   - **Select day and time** (if daily): Choose the time to run
4. Click **Save**

Now the script will run automatically on your schedule.

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

### "Sheet not found" Error
- Verify that a sheet tab named `Devices/Hardware` exists in your spreadsheet
- Or update the `sheetName` property in `INCIDENT_IQ_CONFIG` to match your actual sheet name

### "Configure INCIDENT_IQ_CONFIG" Error
- One or more required config values are missing:
  - `subdomain`
  - `siteId`
  - `apiToken`
  - `viewId`
- Check that all four values are filled in (non-empty strings)

### "Incident IQ request failed (401)" Error
- Your API token is invalid or has expired
- Generate a new token in Incident IQ and update `apiToken` in the config

### "Incident IQ request failed (403)" Error
- Your API token doesn't have permission to access the endpoints
- Verify the token has rights to `POST /api/v1.0/tickets` and `POST /api/v1.0/tickets/slas`

### SLA Column Shows Only "Actual" Value
- The script is finding actual resolution time but not the SLA target
- Set `debugMode: true` and run the script
- Check **View** → **Logs** for debug output
- Look for lines containing "Debug - slaDetails keys" to see the actual API response structure
- Report this to support with the debug output

### No Data Appears in Spreadsheet
- Enable debug mode to see detailed logs
- Verify the view (viewId) contains tickets
- Check that the sheet tab is correct
- Verify `startRow` and `startColumn` point to an empty area (or be prepared to overwrite existing data)

## Configuration Reference

### INCIDENT_IQ_CONFIG Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `subdomain` | string | `""` | Subdomain of your Incident IQ tenant URL |
| `siteId` | string | `""` | GUID of your active Incident IQ site |
| `apiToken` | string | `""` | Bearer token for API authentication |
| `viewId` | string | `""` | GUID of the view to sync |
| `startRow` | number | `2` | Row to begin writing data |
| `startColumn` | number | `5` | Column to begin writing (1=A, 2=B, 5=E) |
| `sheetName` | string | `"Devices/Hardware"` | Name of the target sheet tab |
| `pageSize` | number | `1000` | Records per API request (1-1000) |
| `debugMode` | boolean | `false` | Enable/disable console logging |
| `debugLimit` | number | `100` | Max records to fetch in debug mode |

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
