# Archify Reader

English | [简体中文](README.zh-CN.md)

Start from a node in an Archify diagram, read its business explanation in place against the exact source of a fixed commit, and keep reading along node references.

This is an unofficial companion skill. Archify generates the diagram; the Reader adds a reading layer on top of its HTML: whole-node hover annotations, Markdown detail panels, plain language shown side by side with source code, and node-to-node references with a way back. Source code is embedded at build time, so reading requires no network access and no source repository.

## Try it first

Double-click `examples/campus-events/diagram.reader.html`. Select a node, then click “Details” in the toolbar; links in the text jump between nodes and return you to your original reading position.
The example is a fictional campus event registration system, written specifically for public sharing. The diagram and example text are in English, while the Reader's action buttons are in Chinese. The sample business source has not been run and is not intended as a production-system example.

## Use it on your own project

Requires Node.js 22 or newer, local Git, the official Archify, and the source repository you want to analyze.

Give the full `skill/archify-reader` directory to your coding agent to read, or copy it into your tool's skill directory. Do not copy only SKILL.md. The official Archify must be set up separately; this package does not install or upgrade it.

You can tell the agent directly:

> Use the official Archify and archify-reader to analyze the specified business flows of this project. Read the reader's SKILL.md first, verify the source at a fixed commit, generate the diagram and readable business details, and provide source evidence for the existing implementation. Keep the native diagram and output the enhanced HTML; mark anything factually unclear, and do not modify tool code to bypass checks.

If you already have an enhanced diagram:

> Add evidence on top of the existing MD and reader.json, keeping the original diagram, node IDs, references, and correct narrative, then generate an enhanced version under the same name. When you find errors in the original text, list the evidence and the reason for each change.

Standard build command:

```text
node skill/archify-reader/scripts/build.mjs <path-to-your-reader.json>
```

See `skill/archify-reader/references/` for the full format of evidence and references. Source code comes from commits; uncommitted changes never enter the evidence.

## Rebuild the bundled example

Run from the package root (quote any path containing spaces):

```text
node scripts/build-demo.mjs "<official Archify directory>/archify/bin/archify.mjs"
```

The directory layout inside the official skill ZIP may differ; use the actual `bin/archify.mjs` path. The script outputs JSON where `html` is the finished artifact and `manifest` can be used for browser verification.
To rebuild only the reading layer, run `node scripts/build-demo.mjs` — it reuses the native diagram bundled with this package.

The script only creates a fictional source Git repository and build files inside the system temp directory; it never modifies this package or your project repository. No Python service or FastAPI installation is required. The temp source commit changes whenever the source or line endings change; every build uses the full hash it actually generated.

## Testing and boundaries

```text
node --test skill/archify-reader/test/build.test.mjs skill/archify-reader/test/evidence.test.mjs skill/archify-reader/test/references.test.mjs
node scripts/check-browser.cjs <manifest path from the previous step>
```

Browser tests need Playwright and Chrome; an existing Playwright installation can be provided via NODE_PATH. This package requires no npm dependencies at runtime.
Compatibility results are in `COMPATIBILITY.md`. Public verification currently covers the Workflow samples only — this must not be read as a claim that all diagram types and versions work.

The build checks prove that source provenance and mapping formats are valid; they do not prove that the business explanations are correct, that paragraph coverage is complete, or that the code runs correctly. The Reader adapts to Archify's DOM markers, which is not yet an official stable extension interface.
Enhanced HTML embeds real source code; before sharing your own artifact, make sure the code inside is safe to publish.

## Credits and licensing

Maintainer: **pioneer**. The project is released under the [MIT License](LICENSE) — use, modification, distribution, and commercial use are permitted; keep the copyright and license notices when redistributing. Third-party components keep their own notices; see [third-party sources](THIRD-PARTY-NOTICES.md).

pioneer defined the requirements and made the final calls on the reading experience; implementation, testing, and documentation were done with AI assistance. GitHub maintainer: [pioneer666-user](https://github.com/pioneer666-user). Problems, usage feedback, and reproducible examples are welcome via this repository's Issues.
