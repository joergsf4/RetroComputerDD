const { DateTime } = require("luxon");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const hasha = require("hasha");
const touch = require("touch");
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const execFile = promisify(require("child_process").execFile);
const pluginRss = require("@11ty/eleventy-plugin-rss");
const pluginSyntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const pluginNavigation = require("@11ty/eleventy-navigation");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const localImages = require("./third_party/eleventy-plugin-local-images/.eleventy.js");
const CleanCSS = require("clean-css");
const GA_ID = require("./_data/metadata.json").googleAnalyticsId;

//gallery
const sharp = require('sharp');
const Image = require('@11ty/eleventy-img');

const GALLERY_IMAGE_WIDTH = 192;
const LANDSCAPE_LIGHTBOX_IMAGE_WIDTH = 2000;
const PORTRAIT_LIGHTBOX_IMAGE_WIDTH = 720;

function galleryShortcode(content, name) {
    return `
        <div>
            <div class="gallery" id="gallery-${name}">
                ${content}
            </div>
            <script type="module">
                import PhotoSwipeLightbox from '/js/photoswipe-lightbox.esm.js';
                const lightbox = new PhotoSwipeLightbox({
                    gallery: '#gallery-${name}',
                    children: 'a',
                    pswpModule: () => import('/js/photoswipe.esm.js')
                });
                lightbox.init();
            </script>
        </div>
    `.replace(/(\r\n|\n|\r)/gm, "");
}

async function galleryImageShortcode(src, alt) {
    let lightboxImageWidth = LANDSCAPE_LIGHTBOX_IMAGE_WIDTH;

    const metadata = await sharp(src).metadata();
    if (metadata.orientation > 1) {
        console.log('Rotated image detected:', src, metadata.orientation);
        await sharp(src).rotate().toFile(`correct/${src.split("/").pop()}`);
    }

    if(metadata.height > metadata.width) {
        lightboxImageWidth = PORTRAIT_LIGHTBOX_IMAGE_WIDTH;
    }

    const options = {
        formats: ['jpeg'],
        widths: [GALLERY_IMAGE_WIDTH, lightboxImageWidth],
        urlPath: "/gen/",
        outputDir: './_site/gen/'
    }

    const genMetadata = await Image(src, options);

    return `
        <a href="${genMetadata.jpeg[1].url}" 
        data-pswp-width="${genMetadata.jpeg[1].width}" 
        data-pswp-height="${genMetadata.jpeg[1].height}" 
        target="_blank">
            <img src="${genMetadata.jpeg[0].url}" alt="${alt}" />
        </a>
    `.replace(/(\r\n|\n|\r)/gm, "");;
}

//gallery end

const Nunjucks = require("nunjucks");

module.exports = function (eleventyConfig) {
  
  //gallery

  // Register galleryImage as a Nunjucks tag
  eleventyConfig.addNunjucksAsyncShortcode('galleryImage', galleryImageShortcode);
  eleventyConfig.addPairedNunjucksShortcode('gallery', galleryShortcode);

  eleventyConfig.addPassthroughCopy('js');
  eleventyConfig.addPassthroughCopy('css');
  //gallery end

  eleventyConfig.addPlugin(pluginRss);
  eleventyConfig.addPlugin(pluginSyntaxHighlight);
  eleventyConfig.addPlugin(pluginNavigation);

  eleventyConfig.addPlugin(localImages, {
    distPath: "_site",
    assetPath: "/img/remote",
    selector:
      "img,amp-img,amp-video,meta[property='og:image'],meta[name='twitter:image'],amp-story",
    verbose: false,
  });

  eleventyConfig.addPlugin(require("./_11ty/img-dim.js"));
  eleventyConfig.addPlugin(require("./_11ty/json-ld.js"));
  eleventyConfig.addPlugin(require("./_11ty/optimize-html.js"));
  eleventyConfig.addPlugin(require("./_11ty/apply-csp.js"));
  eleventyConfig.setDataDeepMerge(true);
  eleventyConfig.addLayoutAlias("post", "layouts/post.njk");
  eleventyConfig.addNunjucksAsyncFilter(
    "addHash",
    function (absolutePath, callback) {
      readFile(path.join(".", absolutePath), {
        encoding: "utf-8",
      })
        .then((content) => {
          return hasha.async(content);
        })
        .then((hash) => {
          callback(null, `${absolutePath}?hash=${hash.substr(0, 10)}`);
        })
        .catch((error) => {
          callback(
            new Error(`Failed to addHash to '${absolutePath}': ${error}`)
          );
        });
    }
  );

  async function lastModifiedDate(filename) {
    try {
      const { stdout } = await execFile("git", [
        "log",
        "-1",
        "--format=%cd",
        filename,
      ]);
      return new Date(stdout);
    } catch (e) {
      console.error(e.message);
      // Fallback to stat if git isn't working.
      const stats = await stat(filename);
      return stats.mtime; // Date
    }
  }
  // Cache the lastModifiedDate call because shelling out to git is expensive.
  // This means the lastModifiedDate will never change per single eleventy invocation.
  const lastModifiedDateCache = new Map();
  eleventyConfig.addNunjucksAsyncFilter(
    "lastModifiedDate",
    function (filename, callback) {
      const call = (result) => {
        result.then((date) => callback(null, date));
        result.catch((error) => callback(error));
      };
      const cached = lastModifiedDateCache.get(filename);
      if (cached) {
        return call(cached);
      }
      const promise = lastModifiedDate(filename);
      lastModifiedDateCache.set(filename, promise);
      call(promise);
    }
  );

  eleventyConfig.addFilter("encodeURIComponent", function (str) {
    return encodeURIComponent(str);
  });

  eleventyConfig.addFilter("cssmin", function (code) {
    return new CleanCSS({}).minify(code).styles;
  });

  eleventyConfig.addFilter("readableDate", (dateObj) => {
    return DateTime.fromJSDate(dateObj, { zone: "utc" }).toFormat(
      "dd LLL yyyy"
    );
  });

  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string
  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return DateTime.fromJSDate(dateObj, { zone: "utc" }).toFormat("yyyy-LL-dd");
  });
  

  eleventyConfig.addFilter("sitemapDateTimeString", (dateObj) => {
    const dt = DateTime.fromJSDate(dateObj, { zone: "utc" });
    if (!dt.isValid) {
      return "";
    }
    return dt.toISO();
  });

  // Get the first `n` elements of a collection.
  eleventyConfig.addFilter("head", (array, n) => {
    if (n < 0) {
      return array.slice(n);
    }

    return array.slice(0, n);
  });

  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByTag("posts");
  });
  eleventyConfig.addCollection("events", function (collectionApi) {
    return collectionApi.getFilteredByTag("events");
  });

  // Create a custom collection for gallery images
  eleventyConfig.addCollection("galleryImages", function() {
    const galleryPath = path.join(__dirname, 'img/gallery');
    const files = fs.readdirSync(galleryPath);
    return files.map(file => {
      const filePath = path.join(galleryPath, file);
      const data = {}; // Placeholder for image metadata
      // Example: Read metadata from a JSON file with the same name as the image
      const metadataPath = filePath.replace(/\.[^/.]+$/, ".json");
      if (fs.existsSync(metadataPath)) {
        Object.assign(data, JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
      }
      return {
        name: file,
        path: `img/gallery/${file}`,
        data: data
      };
    });
  });

  // Create a custom collection for gallery images
  eleventyConfig.addCollection("retropartyImages", function() {
    const galleryPath = path.join(__dirname, 'img/retroparty2024');
    const files = fs.readdirSync(galleryPath);
    return files.map(file => {
      const filePath = path.join(galleryPath, file);
      const data = {}; // Placeholder for image metadata
      // Example: Read metadata from a JSON file with the same name as the image
      const metadataPath = filePath.replace(/\.[^/.]+$/, ".json");
      if (fs.existsSync(metadataPath)) {
        Object.assign(data, JSON.parse(fs.readFileSync(metadataPath, 'utf8')));
      }
      return {
        name: file,
        path: `img/retroparty2024/${file}`,
        data: data
      };
    });
  });
  
  eleventyConfig.addCollection("tagList", require("./_11ty/getTagList"));
  eleventyConfig.addPassthroughCopy("img");
  eleventyConfig.addPassthroughCopy("css");
  // We need to copy cached.js only if GA is used
  eleventyConfig.addPassthroughCopy(GA_ID ? "js" : "js/*[!cached].*");
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy("_headers");

  // We need to rebuild upon JS change to update the CSP.
  eleventyConfig.addWatchTarget("./js/");
  // We need to rebuild on CSS change to inline it.
  eleventyConfig.addWatchTarget("./css/");
  // Unfortunately this means .eleventyignore needs to be maintained redundantly.
  // But without this the JS build artefacts doesn't trigger a build.
  eleventyConfig.setUseGitIgnore(false);

  /* Markdown Overrides */
  let markdownLibrary = markdownIt({
    html: true,
    breaks: true,
    linkify: true,
  }).use(markdownItAnchor, {
    permalink: true,
    permalinkClass: "direct-link",
    permalinkSymbol: "#",
  });
  eleventyConfig.setLibrary("md", markdownLibrary);

  // After the build touch any file in the test directory to do a test run.
  eleventyConfig.on("afterBuild", async () => {
    const files = await readdir("test");
    for (const file of files) {
      touch(`test/${file}`);
      break;
    }
  });

  return {
    templateFormats: ["md", "njk", "html", "liquid"],

    // If your site lives in a different subdirectory, change this.
    // Leading or trailing slashes are all normalized away, so don’t worry about those.

    // If you don’t have a subdirectory, use "" or "/" (they do the same thing)
    // This is only used for link URLs (it does not affect your file structure)
    // Best paired with the `url` filter: https://www.11ty.io/docs/filters/url/

    // You can also pass this in on the command line using `--pathprefix`
    // pathPrefix: "/",

    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",

    // These are all optional, defaults are shown:
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      // Warning hardcoded throughout repo. Find and replace is your friend :)
      output: "_site",
    },
  };
  
};