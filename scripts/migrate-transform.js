/**
 * Migration Step 2: Transform fetched data into upload-ready format
 *
 * - Strips Strapi internal fields (id, documentId, createdAt, etc.)
 * - Downloads all media files from Strapi Cloud CDN
 * - Maps relations to name/slug references (for lookup during upload)
 * - Outputs clean JSON + downloaded media to migration-data/transformed/
 *
 * Usage:
 *   node scripts/migrate-transform.js
 */

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');

// --- Config ---
const INPUT_DIR = path.join(__dirname, 'migration-data');
const OUTPUT_DIR = path.join(__dirname, 'migration-data', 'transformed');
const MEDIA_DIR = path.join(OUTPUT_DIR, 'media');

// --- Helpers ---
function loadJSON(filename) {
  const filePath = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  Warning: ${filename} not found, skipping.`);
    return null;
  }
  return fs.readJSONSync(filePath);
}

async function saveJSON(filename, data) {
  const filePath = path.join(OUTPUT_DIR, filename);
  await fs.writeJSON(filePath, data, { spaces: 2 });
  const count = Array.isArray(data) ? `${data.length} items` : 'single';
  console.log(`  Saved: ${filename} (${count})`);
}

/**
 * Download a file from a URL to a local path
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    client
      .get(url, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
        }

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

/**
 * Download a media object and return local filename reference
 */
async function downloadMedia(mediaObj) {
  if (!mediaObj || !mediaObj.url) return null;

  // Build a clean filename from the URL
  const urlPath = new URL(mediaObj.url).pathname;
  const filename = path.basename(urlPath);
  const destPath = path.join(MEDIA_DIR, filename);

  if (fs.existsSync(destPath)) {
    console.log(`    Skipping (already downloaded): ${filename}`);
  } else {
    console.log(`    Downloading: ${filename}`);
    await downloadFile(mediaObj.url, destPath);
  }

  return {
    localFile: filename,
    originalUrl: mediaObj.url,
    alternativeText: mediaObj.alternativeText || null,
    name: mediaObj.name || filename,
    mime: mediaObj.mime || null,
    width: mediaObj.width || null,
    height: mediaObj.height || null,
  };
}

/**
 * Strip Strapi internal fields from an object
 */
function stripInternals(obj) {
  const { id, documentId, createdAt, updatedAt, publishedAt, locale, ...rest } = obj;
  return rest;
}

// --- Transform functions ---

async function transformAuthors(authors) {
  console.log('\n--- Transforming Authors ---');
  if (!authors) return [];

  const transformed = [];
  for (const author of authors) {
    const clean = stripInternals(author);

    // Download avatar if present
    clean.avatar = await downloadMedia(author.avatar);

    // Clean social links
    clean.social_links = (author.social_links || []).map(stripInternals);

    transformed.push(clean);
  }

  await saveJSON('authors.json', transformed);
  return transformed;
}

async function transformCategories(categories) {
  console.log('\n--- Transforming Categories ---');
  if (!categories) return [];

  const transformed = [];
  for (const cat of categories) {
    const clean = stripInternals(cat);

    // Download meta_image if present
    clean.meta_image = await downloadMedia(cat.meta_image);

    // Remove nested blog_posts (we'll rebuild relations from blog post side)
    delete clean.blog_posts;

    transformed.push(clean);
  }

  await saveJSON('categories.json', transformed);
  return transformed;
}

async function transformTags(tags) {
  console.log('\n--- Transforming Tags ---');
  if (!tags) return [];

  const transformed = [];
  for (const tag of tags) {
    const clean = stripInternals(tag);

    // Remove nested blog_posts
    delete clean.blog_posts;

    transformed.push(clean);
  }

  await saveJSON('tags.json', transformed);
  return transformed;
}

async function transformBlogPosts(posts) {
  console.log('\n--- Transforming Blog Posts ---');
  if (!posts) return [];

  const transformed = [];
  for (const post of posts) {
    console.log(`  Processing: "${post.title}"`);
    const clean = stripInternals(post);

    // Download cover_image
    clean.cover_image = await downloadMedia(post.cover_image);

    // Download meta_image
    clean.meta_image = await downloadMedia(post.meta_image);

    // Map author to name (for lookup during upload)
    clean.author = post.author ? post.author.name : null;

    // Map categories to slugs
    clean.categories = (post.categories || []).map((c) => c.slug);

    // Map tags to slugs
    clean.tags = (post.tags || []).map((t) => t.slug);

    // Process content blocks — download any embedded media
    clean.content = await transformContentBlocks(post.content || []);

    // Preserve dates for re-setting after upload
    clean._publishedAt = post.publishedAt;
    clean._createdAt = post.createdAt;

    transformed.push(clean);
  }

  await saveJSON('blog-posts.json', transformed);
  return transformed;
}

/**
 * Walk through dynamic zone content blocks and download any embedded media
 */
async function transformContentBlocks(blocks) {
  const transformed = [];

  for (const block of blocks) {
    const clean = { ...block };

    // Strip component-level id
    delete clean.id;

    switch (block.__component) {
      case 'shared.image-block':
        clean.image = await downloadMedia(block.image);
        break;

      case 'shared.media':
        // Could have nested files
        if (block.file) {
          clean.file = await downloadMedia(block.file);
        }
        break;

      case 'shared.slider':
        if (block.files && Array.isArray(block.files)) {
          clean.files = [];
          for (const file of block.files) {
            clean.files.push(await downloadMedia(file));
          }
        }
        break;

      // rich-text, embed, callout, quote, quote-block — no media to download
      default:
        break;
    }

    transformed.push(clean);
  }

  return transformed;
}

// --- Main ---
async function main() {
  console.log('=== Strapi Migration — Step 2: Transform ===');

  await fs.ensureDir(OUTPUT_DIR);
  await fs.ensureDir(MEDIA_DIR);

  // Load raw data
  const authors = loadJSON('authors.json');
  const categories = loadJSON('categories.json');
  const tags = loadJSON('tags.json');
  const blogPosts = loadJSON('blog-posts.json');

  // Transform
  const tAuthors = await transformAuthors(authors);
  const tCategories = await transformCategories(categories);
  const tTags = await transformTags(tags);
  const tBlogPosts = await transformBlogPosts(blogPosts);

  // List downloaded media
  const mediaFiles = await fs.readdir(MEDIA_DIR);

  // Summary
  console.log('\n=== Transform Summary ===');
  console.log(`  Authors:      ${tAuthors.length}`);
  console.log(`  Categories:   ${tCategories.length}`);
  console.log(`  Tags:         ${tTags.length}`);
  console.log(`  Blog Posts:   ${tBlogPosts.length}`);
  console.log(`  Media files:  ${mediaFiles.length}`);
  console.log(`\nTransformed data: ${OUTPUT_DIR}`);
  console.log(`Downloaded media: ${MEDIA_DIR}`);
  console.log('\nReview the transformed JSON files, then proceed to Step 3 (upload).');
}

main().catch((err) => {
  console.error('\nTransform failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
