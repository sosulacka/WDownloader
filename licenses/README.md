# Third-party components

The GPL-3.0-only license applies to Wdownloader's own code. Third-party
components retain their original licenses and copyright notices.

- Manrope: SIL Open Font License 1.1, see `Manrope-OFL.txt`.
  Source: https://github.com/sharanda/manrope
- Keyline Icons: MIT, see `Keyline-Icons-MIT.txt`.
  Source: https://github.com/keyline-icons/keyline-icons
- JavaScript dependencies and their exact versions are recorded in
  `package-lock.json`; Rust dependencies are recorded in both `Cargo.lock` files.
  Their license notices are included in the upstream packages and crate sources.

The lightweight installer and portable archive do not bundle yt-dlp, FFmpeg
or Deno. The application downloads these external tools at runtime.
The optional local offline build uses the tools prepared by
`npm run setup:tools`; its notices are included in `tools/THIRD-PARTY.txt`.
