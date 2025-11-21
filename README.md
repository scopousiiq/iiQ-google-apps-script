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
- **Ticket Type Filtering**: Optional filtering by single or multiple ticket types (comma-separated)
- **Tag Filtering**: Optional filtering by single or multiple tags (comma-separated)
- **SLA Formatting**: Displays SLA target and actual resolution times in the format: `Sla: < 2 Days / Actual: 6.2 Days`
- **Multi-Sheet Sync**: Configure multiple sheets in a single Config sheet and sync all in one execution
- **Pagination Support**: Handles large datasets with configurable page size
- **Debug Mode**: Optional debug logging to troubleshoot sync issues
- **Error Handling**: Validates configuration and reports errors; continues syncing other sheets if one fails

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

1. In the `Code.gs` file, locate the `INCIDENT_IQ_CONFIG` object near the top (lines 8-38)
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
   - **Column B**: Ticket Type ID(s)
   - **Column C**: View ID
   - **Column D**: Tags
   - **Column E**: Start Row (optional, defaults to 2)
   - **Column F**: Start Column (optional, defaults to 5)

3. Add a row for each sheet you want to sync with its configuration:

| Sheet Name | Ticket Type ID(s) | View ID | Tags | Start Row | Start Column |
|---|---|---|---|---|---|
| Devices/Hardware | `{ticket-type-id-1}` | `{view-id-1}` | `{tag-id-1},{tag-id-2}` | 2 | 5 |
| Software Licenses | | `{view-id-2}` | `{tag-id-3}` | 2 | 5 |

   - **Sheet Name**: Must match an existing sheet tab in your workbook (required)
   - **Ticket Type ID(s)**: GUID(s) of the ticket type(s) to filter by. Obtain from `GET /api/v1.0/tickets/wizards` API. Supports multiple values as comma-separated list (optional)
   - **View ID**: GUID of the view containing tickets to sync. Obtain from `GET /api/v1.0/users/views` API (required)
   - **Tags**: GUID(s) of tags to filter by. Obtain from `POST /api/v1.0/tags/query` API. Supports multiple values as comma-separated list (optional)
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

### Populating Reference Sheets for Easy Configuration

The script includes two utility functions that fetch available ticket types and tags from Incident IQ and populate reference sheets in your spreadsheet. This makes it easy to find the correct IDs to use in your Config sheet without manually calling the API.

#### Option 1: Populate Ticket Types Reference

Before configuring your Config sheet, you may want to see which ticket types are available:

1. In your Google Sheet, create a new sheet tab named **`Ticket Types`**
2. In the Apps Script editor, click the **▶ Run** button dropdown and select **`populateTicketTypeReference`** (or just click **Run**)
3. Grant authorization if prompted
4. Return to your Google Sheet and refresh/reload the page
5. The `Ticket Types` sheet will now contain all available ticket types with their IDs:
   - **Column A**: Ticket Type Name (e.g., "Devices / Hardware")
   - **Column B**: Ticket Type ID (the GUID to copy into your Config sheet)
6. Copy the IDs you need into the "Ticket Type ID(s)" column in your Config sheet

#### Option 2: Populate Ticket Tags Reference

Similarly, to see which tags are available:

1. In your Google Sheet, create a new sheet tab named **`Ticket Tags`**
2. In the Apps Script editor, click the **▶ Run** button dropdown and select **`populateTicketTagsReference`** (or just click **Run**)
3. Grant authorization if prompted
4. Return to your Google Sheet and refresh/reload the page
5. The `Ticket Tags` sheet will now contain all available tags with their IDs:
   - **Column A**: Tag Name (e.g., "Security Incident", "Authorized for BPS101")
   - **Column B**: Tag ID (the GUID to copy into your Config sheet)
6. Copy the IDs you need into the "Tags" column in your Config sheet (comma-separated if multiple)

**Note**: These reference sheets are **optional** and only used for lookup. The script will work perfectly fine without them. However, they make configuration much easier, especially for non-technical users who don't want to manually call the API endpoints.

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
- Filters tickets by view facet (required)
- Optionally filters by ticket type facet(s) (one or more)
- Optionally filters by tag facet(s) (one or more)
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

### "View ID is required" Error
- A row in the Config sheet is missing the required View ID
- Check row number in the error message
- Add the missing View ID to that row
- Note: Ticket Type ID and Tags are optional and can be left blank

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
| B | Ticket Type ID(s) | No | GUID(s) of ticket type(s) to filter by. Obtain from `GET /api/v1.0/tickets/wizards` API. Use CSV for multiple | `{ticket-type-id-1},{ticket-type-id-2}` |
| C | View ID | Yes | GUID of the view to sync. Obtain from `GET /api/v1.0/users/views` API | `{view-id}` |
| D | Tags | No | GUID(s) of tags to filter by. Obtain from `POST /api/v1.0/tags/query` API. Use CSV for multiple | `{tag-id-1},{tag-id-2}` |
| E | Start Row | No | Row to begin writing (default: 2) | `2` |
| F | Start Column | No | Column to begin writing (default: 5 for F) | `5` |

**Notes**:
- The first row should be a header row (will be skipped during processing)
- Empty rows in the Config sheet are skipped
- Only Sheet Name and View ID are required; all other columns are optional
- Ticket Type ID(s) and Tags support comma-separated values (e.g., `id1,id2,id3`)
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
