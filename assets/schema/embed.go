package schemaassets

import "embed"

// FS contains versioned BDO preset maps shipped with the application.
//
//go:embed version20.json
var FS embed.FS
