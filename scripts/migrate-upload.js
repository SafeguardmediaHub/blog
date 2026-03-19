/**
 * Migration Step 3: Upload transformed data to new Strapi instance
 *
 * Order: Media → Authors → Categories → Tags → Blog Posts
 * (Blog posts depend on the other three being created first)
 *
 * Usage:
 *   STRAPI_DEST_URL=https://your-new-strapi.com \
 *   STRAPI_DEST_TOKEN=your-api-token \
 *   node scripts/migrate-upload.js
 *
 * The dest token needs full-access permissions (create on all content types).
 */

const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

// --- Config ---
const DEST_URL = process.env.STRAPI_DEST_URL;
const DEST_TOKEN = process.env.STRAPI_DEST_TOKEN;

if (!DEST_URL || !DEST_TOKEN) {
  console.error('Missing env vars. Set STRAPI_DEST_URL and STRAPI_DEST_TOKEN');
  process.exit(1);
}

const INPUT_DIR = path.join(__dirname, 'migration-data', 'transformed');
const MEDIA_DIR = path.join(INPUT_DIR, 'media');

// Maps old references to new IDs
const idMaps = {
  authors: {}, // name -> new documentId
  categories: {}, // slug -> new documentId
  tags: {}, // slug -> new documentId
  media: {}, // localFile -> new media id
};

// --- Helpers ---
function loadJSON(filename) {
  const filePath = path.join(INPUT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  Warning: ${filename} not found, skipping.`);
    return null;
  }
  return fs.readJSONSync(filePath);
}

async function strapiPost(endpoint, data) {
  const url = `${DEST_URL}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`POST ${endpoint} → ${res.status}: ${errorBody}`);
  }

  return res.json();
}

/**
 * Upload a media file via Strapi's upload API
 * Returns the media object from Strapi (with id, url, etc.)
 */
async function uploadMedia(mediaRef) {
  if (!mediaRef || !mediaRef.localFile) return null;

  // Check if already uploaded
  if (idMaps.media[mediaRef.localFile]) {
    return idMaps.media[mediaRef.localFile];
  }

  const filePath = path.join(MEDIA_DIR, mediaRef.localFile);
  if (!fs.existsSync(filePath)) {
    console.warn(`    Media file not found: ${mediaRef.localFile}`);
    return null;
  }

  const FormData = (await import('undici')).FormData;
  const formData = new FormData();

  const fileBuffer = await fs.readFile(filePath);
  const blob = new Blob([fileBuffer], { type: mediaRef.mime || 'application/octet-stream' });
  formData.append('files', blob, mediaRef.name || mediaRef.localFile);

  if (mediaRef.alternativeText) {
    formData.append('fileInfo', JSON.stringify({ alternativeText: mediaRef.alternativeText }));
  }

  const url = `${DEST_URL}/api/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEST_TOKEN}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Upload ${mediaRef.localFile} → ${res.status}: ${errorBody}`);
  }

  const result = await res.json();
  const uploaded = result[0]; // Upload API returns an array
  console.log(`    Uploaded: ${mediaRef.localFile} → id ${uploaded.id}`);

  idMaps.media[mediaRef.localFile] = uploaded;
  return uploaded;
}

// --- Upload functions ---

async function uploadAuthors(authors) {
  console.log('\n--- Uploading Authors ---');
  if (!authors) return;

  for (const author of authors) {
    console.log(`  Creating author: ${author.name}`);

    // Upload avatar first if present
    let avatarId = null;
    if (author.avatar) {
      const uploaded = await uploadMedia(author.avatar);
      avatarId = uploaded?.id || null;
    }

    const payload = {
      name: author.name,
      bio: author.bio || null,
      email: author.email || null,
    };

    const res = await strapiPost('/api/authors', payload);
    const newId = res.data.documentId;
    idMaps.authors[author.name] = newId;
    console.log(`    Created: ${author.name} → ${newId}`);

    // Attach avatar via separate upload link if needed
    if (avatarId) {
      await linkMediaToEntry('api::author.author', res.data.id, 'avatar', avatarId);
    }
  }
}

async function uploadCategories(categories) {
  console.log('\n--- Uploading Categories ---');
  if (!categories) return;

  for (const cat of categories) {
    console.log(`  Creating category: ${cat.name}`);

    const payload = {
      name: cat.name,
      description: cat.description || null,
      slug: cat.slug,
      meta_title: cat.meta_title || null,
      meta_description: cat.meta_description || null,
    };

    const res = await strapiPost('/api/categories', payload);
    const newId = res.data.documentId;
    idMaps.categories[cat.slug] = newId;
    console.log(`    Created: ${cat.name} → ${newId}`);
  }
}

async function uploadTags(tags) {
  console.log('\n--- Uploading Tags ---');
  if (!tags) return;

  for (const tag of tags) {
    console.log(`  Creating tag: ${tag.name}`);

    const payload = {
      name: tag.name,
      slug: tag.slug || null,
      description: tag.description || null,
      meta_title: tag.meta_title || null,
      meta_description: tag.meta_description || null,
    };

    const res = await strapiPost('/api/tags', payload);
    const newId = res.data.documentId;
    idMaps.tags[tag.slug] = newId;
    console.log(`    Created: ${tag.name} → ${newId}`);
  }
}

/**
 * Link a media file to an entry field using Strapi's upload API
 */
async function linkMediaToEntry(uid, entryId, field, mediaId) {
  const url = `${DEST_URL}/api/upload?id=${entryId}&model=${uid}&field=${field}`;
  // Use the PUT method on the content API instead
  const apiEndpoint = uid.replace('api::', '').split('.')[0];
  const putUrl = `${DEST_URL}/api/${apiEndpoint}s/${entryId}`;

  // Actually, just set the relation via the content API update
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${DEST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { [field]: mediaId } }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    console.warn(`    Warning: Could not link ${field} to entry: ${errorBody}`);
  }
}

async function uploadBlogPosts(posts) {
  console.log('\n--- Uploading Blog Posts ---');
  if (!posts) return;

  for (const post of posts) {
    console.log(`  Creating post: "${post.title}"`);

    // Upload cover image
    let coverImageId = null;
    if (post.cover_image) {
      const uploaded = await uploadMedia(post.cover_image);
      coverImageId = uploaded?.id || null;
    }

    // Upload meta image (skip if same file as cover)
    let metaImageId = null;
    if (post.meta_image) {
      if (post.cover_image && post.meta_image.localFile === post.cover_image.localFile) {
        metaImageId = coverImageId;
      } else {
        const uploaded = await uploadMedia(post.meta_image);
        metaImageId = uploaded?.id || null;
      }
    }

    // Process content blocks — upload any embedded media
    const content = await processContentForUpload(post.content || []);

    // Resolve relations
    const authorDocId = post.author ? idMaps.authors[post.author] : null;
    const categoryDocIds = (post.categories || [])
      .map((slug) => idMaps.categories[slug])
      .filter(Boolean);
    const tagDocIds = (post.tags || [])
      .map((slug) => idMaps.tags[slug])
      .filter(Boolean);

    const payload = {
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || null,
      content,
      cover_image: coverImageId,
      meta_image: metaImageId,
      author: authorDocId || null,
      categories: categoryDocIds,
      tags: tagDocIds,
      seo_title: post.seo_title || null,
      seo_description: post.seo_description || null,
      canonical_url: post.canonical_url || null,
      reading_time: post.reading_time || null,
      featured: post.featured || false,
    };

    try {
      const res = await strapiPost('/api/blog-posts', payload);
      console.log(`    Created: "${post.title}" → ${res.data.documentId}`);

      // Publish the post
      const publishUrl = `${DEST_URL}/api/blog-posts/${res.data.documentId}`;
      const pubRes = await fetch(publishUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${DEST_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            // Re-send minimal data to trigger publish
            title: post.title,
          },
          status: 'published',
        }),
      });

      if (pubRes.ok) {
        console.log(`    Published: "${post.title}"`);
      } else {
        const errBody = await pubRes.text().catch(() => '');
        console.warn(`    Warning: Could not publish "${post.title}": ${errBody}`);
      }
    } catch (err) {
      console.error(`    FAILED: "${post.title}" — ${err.message}`);
    }
  }
}

/**
 * Process content blocks for upload — upload any embedded media and replace with IDs
 */
async function processContentForUpload(blocks) {
  const processed = [];

  for (const block of blocks) {
    const clean = { ...block };

    switch (block.__component) {
      case 'shared.image-block':
        if (block.image) {
          const uploaded = await uploadMedia(block.image);
          clean.image = uploaded?.id || null;
        }
        break;

      case 'shared.media':
        if (block.file) {
          const uploaded = await uploadMedia(block.file);
          clean.file = uploaded?.id || null;
        }
        break;

      case 'shared.slider':
        if (block.files && Array.isArray(block.files)) {
          clean.files = [];
          for (const file of block.files) {
            const uploaded = await uploadMedia(file);
            if (uploaded) clean.files.push(uploaded.id);
          }
        }
        break;

      default:
        break;
    }

    processed.push(clean);
  }

  return processed;
}

// --- Main ---
async function main() {
  console.log('=== Strapi Migration — Step 3: Upload ===');
  console.log(`Destination: ${DEST_URL}`);

  // Load transformed data
  const authors = loadJSON('authors.json');
  const categories = loadJSON('categories.json');
  const tags = loadJSON('tags.json');
  const blogPosts = loadJSON('blog-posts.json');

  // Upload in order: authors, categories, tags first (blog posts depend on them)
  await uploadAuthors(authors);
  await uploadCategories(categories);
  await uploadTags(tags);
  await uploadBlogPosts(blogPosts);

  // Summary
  console.log('\n=== Upload Summary ===');
  console.log(`  Authors:    ${Object.keys(idMaps.authors).length} created`);
  console.log(`  Categories: ${Object.keys(idMaps.categories).length} created`);
  console.log(`  Tags:       ${Object.keys(idMaps.tags).length} created`);
  console.log(`  Media:      ${Object.keys(idMaps.media).length} uploaded`);
  console.log('\nMigration complete!');

  // Save ID mappings for reference
  await fs.writeJSON(path.join(INPUT_DIR, 'id-mappings.json'), idMaps, { spaces: 2 });
  console.log('ID mappings saved to: migration-data/id-mappings.json');
}

main().catch((err) => {
  console.error('\nUpload failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
