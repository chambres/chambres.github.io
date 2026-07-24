# terminal version

The `curl rhl.sh` version of the site. A zero-dependency Node server that
streams an ANSI animation to the terminal, then prints the resume.

```bash
node terminal/rhl-server.js      # then, in another shell:
curl localhost:7878              # menu
curl localhost:7878/v2           # an animation
```

## How the animation works

`curl` prints response bytes the moment they arrive, so the *server* controls
the pacing — write a few bytes, sleep, write a few more, and the terminal draws
a typewriter effect. No flags, no shell redirection, just `curl <host>`.

Two details make it work:

- **Every redraw ends with `\n`.** Terminals line-buffer curl's stdout, so
  nothing appears until a newline lands. Each frame therefore prints a whole
  line, then steps the cursor back up with `\x1b[1A` to overwrite it next frame.
- **Frames are full-line repaints**, not diffs, which is what lets letters move
  to arbitrary columns.

## The three animations

All of them turn `curl rhl.sh` into `rahul saravanakumar`; they differ in which
letters survive the trip.

| route | |
|-------|--|
| `/v1` | every letter migrates to its slot in the name |
| `/v2` | greyscale crossfade anchored on `rhl` — it survives, the name grows out of it |
| `/v3` | `rhl` survives whole, `curl` lends only its `u`; the two strands cross |

Add `b` to any of them (`/v2b`) to clear the screen first and play on a blank
terminal. Without it the animation runs in line, below your command, and
nothing above is touched — that version is safe on every prompt and width.

## Pacing

Section headings are drawn in a 3-row mini font (`GLYPH` / `artHead`), and
each section is followed by a `SECTION_PAUSE` beat so it can be read before
the next one arrives. Two knobs at the top of the file:

- `TYPE_SPEED`   how fast the prose types (higher is faster)
- `SECTION_PAUSE` ms of silence between sections

## Content

Nothing is hardcoded. It reads the same files the website does:

- `../data/resume.json` — about, experience, education, projects, skills
- `https://rhl.sh/data/projects.json` — the project list
- the GitHub API — repo/star/follower counts and language split

`resume.json` is fetched from the live site first and falls back to the local
copy, so editing that one file updates the website and this together.

## Notes

- Browsers get a plain HTML page instead; the animation is only sent when the
  User-Agent looks like `curl`/`wget`/`httpie`.
- Needs a host that streams responses. Some serverless/CDN setups buffer the
  whole body before sending, which would collapse the animation into one blob.
- The greyscale fade in `/v2` wants a 256-colour terminal. On an 8-colour TTY
  it still reads fine, just without the gradual dissolve.
