/**
 * Migration Step 1: Fetch all data from Strapi Cloud
 *
 * Usage:
 *   STRAPI_SOURCE_URL=https://your-strapi-cloud-url.com \
 *   STRAPI_SOURCE_TOKEN=your-api-token \
 *   node scripts/migrate-fetch.js
 *
 * Output: scripts/migration-data/  (JSON files for each content type)
 */

const fs = require('fs-extra');
const path = require('path');
const qs = require('qs');
const dotenv = require('dotenv');
dotenv.config();

// --- Config ---
const SOURCE_URL = process.env.STRAPI_SOURCE_URL;
const SOURCE_TOKEN = process.env.STRAPI_SOURCE_TOKEN;

if (!SOURCE_URL || !SOURCE_TOKEN) {
  console.log(SOURCE_URL, SOURCE_TOKEN);
  console.error(
    'Missing env vars. Set STRAPI_SOURCE_URL and STRAPI_SOURCE_TOKEN',
  );
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, 'migration-data');

// --- Helpers ---
async function fetchFromStrapi(endpoint, params = {}) {
  const queryString = qs.stringify(params, { arrayFormat: 'brackets' });
  const url = `${SOURCE_URL}${endpoint}${queryString ? `?${queryString}` : ''}`;

  console.log(`  Fetching: ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SOURCE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(
      `${res.status} ${res.statusText} - ${endpoint}\n${errorBody}`,
    );
  }

  return res.json();
}

/**
 * Fetch all pages of a paginated collection
 */
async function fetchAllPages(endpoint, params = {}) {
  const allData = [];
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const res = await fetchFromStrapi(endpoint, {
      ...params,
      pagination: { page, pageSize: 100 },
    });

    allData.push(...res.data);
    pageCount = res.meta?.pagination?.pageCount || 1;
    console.log(`    Page ${page}/${pageCount} — got ${res.data.length} items`);
    page++;
  }

  return allData;
}

async function saveJSON(filename, data) {
  const filePath = path.join(OUTPUT_DIR, filename);
  await fs.writeJSON(filePath, data, { spaces: 2 });
  console.log(
    `  Saved: ${filePath} (${Array.isArray(data) ? data.length + ' items' : 'single'})`,
  );
}

// --- Fetch functions for each content type ---

async function fetchAuthors() {
  console.log('\n--- Authors ---');
  const data = await fetchAllPages('/api/authors', {
    populate: {
      avatar: {
        fields: ['url', 'alternativeText', 'width', 'height', 'name', 'mime'],
      },
      social_links: { populate: '*' },
    },
  });
  await saveJSON('authors.json', data);
  return data;
}

async function fetchCategories() {
  console.log('\n--- Categories ---');
  const data = await fetchAllPages('/api/categories', {
    populate: {
      meta_image: {
        fields: ['url', 'alternativeText', 'width', 'height', 'name', 'mime'],
      },
    },
  });
  await saveJSON('categories.json', data);
  return data;
}

async function fetchTags() {
  console.log('\n--- Tags ---');
  const data = await fetchAllPages('/api/tags', {
    populate: '*',
  });
  await saveJSON('tags.json', data);
  return data;
}

async function fetchBlogPosts() {
  console.log('\n--- Blog Posts ---');
  const data = await fetchAllPages('/api/blog-posts', {
    populate: {
      content: { populate: '*' },
      cover_image: {
        fields: ['url', 'alternativeText', 'width', 'height', 'name', 'mime'],
      },
      meta_image: {
        fields: ['url', 'alternativeText', 'width', 'height', 'name', 'mime'],
      },
      author: {
        populate: {
          avatar: { fields: ['url', 'alternativeText', 'name', 'mime'] },
        },
      },
      categories: { fields: ['name', 'slug'] },
      tags: { fields: ['name', 'slug'] },
    },
    publicationState: 'preview', // Get both published and drafts
  });
  await saveJSON('blog-posts.json', data);
  return data;
}

async function fetchGlobal() {
  console.log('\n--- Global ---');
  const res = await fetchFromStrapi('/api/global', {
    populate: {
      favicon: { fields: ['url', 'alternativeText', 'name', 'mime'] },
      defaultSeo: {
        populate: {
          shareImage: { fields: ['url', 'alternativeText', 'name', 'mime'] },
        },
      },
    },
  });
  await saveJSON('global.json', res.data);
  return res.data;
}

async function fetchAbout() {
  console.log('\n--- About ---');
  const res = await fetchFromStrapi('/api/about', {
    populate: {
      blocks: { populate: '*' },
    },
  });
  await saveJSON('about.json', res.data);
  return res.data;
}

// --- Main ---
async function main() {
  console.log('=== Strapi Cloud Migration — Step 1: Fetch ===');
  console.log(`Source: ${SOURCE_URL}`);

  await fs.ensureDir(OUTPUT_DIR);

  const authors = await fetchAuthors();
  const categories = await fetchCategories();
  const tags = await fetchTags();
  const blogPosts = await fetchBlogPosts();
  const global = await fetchGlobal();
  const about = await fetchAbout();

  // Summary
  console.log('\n=== Fetch Summary ===');
  console.log(`  Authors:    ${authors.length}`);
  console.log(`  Categories: ${categories.length}`);
  console.log(`  Tags:       ${tags.length}`);
  console.log(`  Blog Posts: ${blogPosts.length}`);
  console.log(`  Global:     ${global ? 'yes' : 'no'}`);
  console.log(`  About:      ${about ? 'yes' : 'no'}`);
  console.log(`\nAll data saved to: ${OUTPUT_DIR}`);
  console.log('Review the JSON files, then proceed to Step 2 (transform).');
}

main().catch((err) => {
  console.error('\nFetch failed:', err.message);
  process.exit(1);
});
