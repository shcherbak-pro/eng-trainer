<script lang="ts">
  import {
    CSV_DETAILED_EXAMPLE,
    CSV_EXAMPLE,
    CSV_GUIDE,
    CSV_SEMICOLON_EXAMPLE,
    CSV_TEMPLATE_FILE_NAME,
    csvTemplateParts,
    formatEntryLimit,
    formatFileLimit,
    nativeJsonExample
  } from '../../collections/importGuide';
  import { downloadFile } from '../../shared/download';
  import Button from '../../shared/ui/Button.svelte';

  /** Viewing, copying and downloading help never reads or writes saved data. */
  let status = '';
  // A reference produced by the real exporter, with new identities for this page view.
  const jsonExample = nativeJsonExample();

  async function copyExample(): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('The clipboard is not available.');
      await navigator.clipboard.writeText(CSV_EXAMPLE);
      status = 'Example copied.';
    } catch {
      status = 'Copying is not available here. Select the example text and copy it.';
    }
  }

  function downloadTemplate(): void {
    downloadFile(CSV_TEMPLATE_FILE_NAME, csvTemplateParts(), 'text/csv;charset=utf-8');
    status = `Template saved as ${CSV_TEMPLATE_FILE_NAME}.`;
  }
</script>

<section class="help-card" aria-labelledby="import-help-title">
  <h3 id="import-help-title" class="help-card__title">How to prepare your file</h3>
  <ul class="help-card__facts">
    <li><strong>Formats:</strong> CSV, or a JSON file exported from eng-trainer.</li>
    <li><strong>CSV encoding:</strong> UTF-8.</li>
    <li><strong>Required columns:</strong> {#each CSV_GUIDE.required as column, index}{#if index}{' and '}{/if}<code>{column}</code>{/each}.</li>
    <li><strong>Limits:</strong> up to {formatFileLimit()} per file and {formatEntryLimit()} entries per collection.</li>
  </ul>
  <p id="csv-example-label" class="field__label">Example CSV</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (A scrollable example must be keyboard reachable.) -->
  <pre class="csv-example" aria-labelledby="csv-example-label" tabindex="0" translate="no">{CSV_EXAMPLE}</pre>
  <div class="help-card__actions">
    <Button variant="secondary" size="sm" icon="download" onClick={downloadTemplate}>Download CSV template</Button>
    <Button variant="quiet" size="sm" icon="copy" onClick={copyExample}>Copy example</Button>
  </div>
  <p class="help-card__status" role="status">{status}</p>

  <details class="help-details">
    <summary>More format details</summary>
    <div class="help-details__body">
      <h4>CSV columns</h4>
      <ul>
        <li>The first row names the columns. {#each CSV_GUIDE.required as column, index}{#if index}{' and '}{/if}<code>{column}</code>{/each} are required.</li>
        <li>Optional columns: {#each CSV_GUIDE.optional as column, index}{#if index}{', '}{/if}<code>{column}</code>{/each}. <code>example</code> holds one English example sentence.</li>
        <li><code>kind</code> is {#each CSV_GUIDE.kinds as kind, index}{#if index}{' or '}{/if}<code>{kind}</code>{/each}, written in lowercase. Without a <code>kind</code> column, or when the value is empty, an entry is a <code>{CSV_GUIDE.defaultKind}</code>.</li>
        <li>Column names may be in any order and in upper or lower case. Other columns, or a column used twice, are not accepted.</li>
        <li>Separate the values with commas. Semicolons work too when the header row uses them, for example <code>{CSV_SEMICOLON_EXAMPLE.split('\n')[0]}</code>.</li>
        <li>Put quotes around a whole value that contains a comma, a semicolon, a quote or a line break. Inside quotes, write a quote as two quotes. Nothing may stand outside the quotes, not even a space.</li>
        <li>Blank lines are skipped. Problems are reported by record number, counting the header row as record 1.</li>
        <li>Any invalid record blocks the whole import: nothing is saved until the file is fixed.</li>
      </ul>
      <p id="csv-detailed-label">A fuller example, with an explicit phrase and quoted values:</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (A scrollable example must be keyboard reachable.) -->
      <pre class="csv-example" aria-labelledby="csv-detailed-label" tabindex="0" translate="no">{CSV_DETAILED_EXAMPLE}</pre>

      <h4>From a spreadsheet</h4>
      <p>
        Put the column names in the first row, then save or export the sheet as <strong>CSV UTF-8</strong>. In Excel, choose File, Save As, and the type
        “CSV UTF-8 (Comma delimited)”. In Google Sheets, choose File, Download, “Comma-separated values (.csv)”. Excel workbooks (.xlsx), PDFs and images cannot be imported.
      </p>

      <h4>JSON</h4>
      <p>
        CSV is the simple way to create a new collection. JSON is the format eng-trainer uses to export collections and import them again. For JSON, choose a file exported from
        eng-trainer. Other JSON structures are not supported.
      </p>
      <ul>
        <li>Importing an exported file again keeps the identities of the collection and its entries, so their learning progress is kept.</li>
        <li>Importing an unchanged export again changes nothing.</li>
        <li>An import never edits saved entries. If a file changes an entry that already exists under the same identity, the import is blocked as an ID conflict.</li>
      </ul>
      <p id="json-example-label">The structure of an export, with example values:</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (A scrollable example must be keyboard reachable.) -->
      <pre class="csv-example" aria-labelledby="json-example-label" tabindex="0" translate="no">{jsonExample}</pre>
      <p class="muted">The identities in this example are created when this page opens. To back up a collection, use “Export JSON” below.</p>
    </div>
  </details>
</section>
