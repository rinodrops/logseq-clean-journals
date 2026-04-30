# Changelog

## 0.4.0
- Added "Trim leading/trailing empty blocks" setting (opt-in, default off). When enabled, consecutive empty blocks at the top and bottom of each in-scope journal page are removed. Today's journal is excluded; empty blocks in the middle are preserved. Honors Dry run.

## 0.3.0
- Dry run is now enabled by default for safety. Turn off in settings to perform actual deletion.
- List target journal dates in the dry run toast and developer console.
- Show dry run results as a persistent warning toast with instructions for performing the actual deletion.
- Lowered the default "Days to look back" from 30 to 10.

## 0.2.0
- Added Days to look back setting to limit the scan range.
- Added Dry run mode.
- Added plugin icon.
- Unified language to English.

## 0.1.0
- Initial release.
- Toolbar button to delete empty journal pages.
