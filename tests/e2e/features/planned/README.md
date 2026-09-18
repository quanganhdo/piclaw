# Planned UX contracts

This root is reserved for desired, unimplemented contracts tagged `@planned @not-implemented`. It currently contains no feature files.

The SVG-image cases introduced by #1324 have moved, without duplicate IDs, to [shared/svg-images.feature](../shared/svg-images.feature). #1325 implements them in both skins and supplies Chromium/WebKit assertions. Import shared acceptance with either skin root; do not treat future planned contracts as passing implementations.
