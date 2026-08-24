# Heirloom Modern

A single-page listing site for a **John Widdicomb walnut double-pedestal extension dining
table** (Grand Rapids, c.1950s, three leaves, extends to 10'5"), offered from Colorado
Springs.

Static, self-contained, no build step. `index.html` is the whole site.

---

## ⚠️ First: give this its own home on GitHub

This code was written inside the `instantcma` repo only because that was the only repo this
session could reach. **It does not belong there.** Two steps to separate it, both in the
GitHub web UI:

1. **Create the organization** — <https://github.com/organizations/plan> → pick Free →
   name it (e.g. `heirloom-modern`). This can't be done through the API, which is why it
   needs you.
2. **Create an empty repo** in that org called `heirloom-modern`, then copy this folder
   into it:

   ```bash
   git clone https://github.com/YOUR-ORG/heirloom-modern.git
   cp -r /path/to/this/heirloom-modern/* /path/to/clone/
   cd /path/to/clone && git add -A && git commit -m "Initial site" && git push
   ```

Then delete the `heirloom-modern/` folder out of `instantcma` so the two businesses stay
cleanly separated.

## Turn on the live site

In the new repo: **Settings → Pages → Source: GitHub Actions**. The workflow in
`.github/workflows/pages.yml` deploys on every push to `main`.

You'll get `https://YOUR-ORG.github.io/heirloom-modern/`. To use a real domain, add a
`CNAME` file containing your domain and point a DNS `CNAME` record at
`YOUR-ORG.github.io`.

## Fill in the placeholders

Search the repo for `REPLACE-WITH-` — every spot that needs your real details is marked:

| Placeholder | Where | What it is |
|---|---|---|
| `REPLACE-WITH-YOUR-DOMAIN` | `index.html`, `robots.txt`, `sitemap.xml` | Your live domain, no trailing slash. **Do this before submitting to Google** — the schema and canonical tags are wrong until you do. |
| `REPLACE-WITH-YOUR-EMAIL` | `index.html`, `LISTING.md` | Contact email for the Inquire button |
| `REPLACEPHONE` / `REPLACE-WITH-YOUR-PHONE` | `index.html`, `LISTING.md` | Phone for the call/text button |

```bash
# once you know the domain:
grep -rl 'REPLACE-WITH-YOUR-DOMAIN' . | xargs sed -i '' 's|REPLACE-WITH-YOUR-DOMAIN|heirloommodern.com|g'
```

## Add the photos

Drop them into `assets/img/` — see [`assets/img/README.md`](assets/img/README.md) for the
exact filenames and shooting notes. Until a file exists the page shows a labelled
placeholder telling you which shot is missing, so nothing ever looks broken.

## Change the listing details

Everything about the table lives in one `LISTING` object near the bottom of `index.html`:

```js
const LISTING = {
  closedInches : 71.25,   // length with no leaves in
  leafInches   : 18,      // width of ONE leaf
  leafCount    : 3,
  depthInches  : 43.88,
  seatsClosed  : 6
};
```

The interactive extension diagram, the length/feet/seats readouts and the scale drawing
all compute from those numbers. Change them and the whole widget follows.

The price, dimensions table and copy are plain HTML — search for `7,500` or `71¼` to find
them. **Also update the matching values in the JSON-LD `<script>` block in `<head>`**, or
Google will index numbers that don't match the page.

## What's in here

```
index.html            the entire site — HTML, CSS, JS, schema, all inline
LISTING.md            the same listing as Markdown, to paste into Facebook
                      Marketplace, Craigslist, forums, etc.
robots.txt            crawler rules (traditional search + AI answer engines)
sitemap.xml           one URL, with image entries
.nojekyll             stops GitHub Pages running Jekyll over the files
assets/img/           your photos go here
.github/workflows/    Pages deploy
```

## SEO notes

Built in already:

- **JSON-LD** — `Product` with a full `Offer` (price, availability, condition, `areaServed`
  covering Colorado Springs → Denver → the Mountain States), plus `Organization`/
  `LocalBusiness` with geo coordinates, `BreadcrumbList`, and `FAQPage` matching the
  on-page FAQ.
- Canonical, Open Graph and Twitter card tags — so the Facebook share renders properly.
- `geo.region` / `geo.placename` for Colorado Springs.
- Semantic headings, alt text on every image, no horizontal overflow, works down to 390px.

After you publish, do these three things:

1. Validate at <https://search.google.com/test/rich-results> — paste the live URL.
2. Submit the sitemap in **Google Search Console**.
3. Post the link on Facebook with a line or two of your own text. The OG tags do the rest.

Google will not index the page while the repo is private, and the schema will be rejected
while the domain is still `REPLACE-WITH-YOUR-DOMAIN`.
