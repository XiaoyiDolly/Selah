# Review input

Pass a UTF-8 JSON file of at most 96 KiB. The `prUrl` value must be the same canonical HTTPS GitHub URL supplied to `--pr`.

```json
{
  "prUrl": "https://github.com/example/project/pull/123",
  "summary": "The change adds bounded retry handling to the importer.",
  "findings": [
    {
      "path": "src/importer.ts",
      "line": 42,
      "severity": "important",
      "issue": "The retry loop repeats non-retryable authentication failures.",
      "evidence": "The catch branch retries every HTTP status, including 401 and 403.",
      "proposedFix": "Retry only timeouts, 408, 429, and transient 5xx responses.",
      "diffHunk": "@@ -38,4 +38,8 @@\n+  return retry(() => request());"
    }
  ],
  "strengths": [
    {
      "strength": "The retry count is explicitly bounded.",
      "evidence": "The loop terminates after three attempts."
    }
  ]
}
```

Allowed severities are `blocking`, `important`, and `suggestion`. Supply no more than five findings, three strengths, 16,000 characters per diff hunk, or 40,000 characters across all hunks. An empty findings array is valid when no consequential issues are found. Include only the minimum diff evidence needed to support each claim.
