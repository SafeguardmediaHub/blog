# Blog UI & Implementation Guide

This document provides a detailed overview of the SafeguardMedia Blog implementation. It covers the architecture, component hierarchy, data fetching strategies, and integration with Strapi v5.

## 🏗️ Architecture

The blog is built using **Next.js 15 App Router** and provides a fully server-side rendered (SSR) experience for optimal SEO and performance.

### Directory Structure

```
src/
├── app/
│   └── blog/
│       ├── layout.tsx        # Wraps all blog pages (Navbar + Footer + Padding)
│       ├── page.tsx          # Main listing page (Featured + Grid + Sidebar)
│       └── [slug]/
│           └── page.tsx      # Individual blog post page
├── components/
│   └── blog/
│       ├── BlockRenderer.tsx # Renders Strapi Dynamic Zones (Rich Text, Quotes, etc.)
│       ├── BlogCard.tsx      # Card component for grid view
│       ├── FeaturedPost.tsx  # Hero component for the highlighted article
│       ├── ShareButtons.tsx  # Social sharing buttons
│       └── ...
└── lib/
    └── strapi.ts             # Typed API client for Strapi v5
```

---

## 🚀 Key Features

### 1. Featured Articles

- **Logic**: The listing page fetches the latest post marked as `featured: true`.
- **Exclusion**: This featured post is automatically **excluded** from the main article grid to prevent duplication.
- **Component**: `FeaturedPost.tsx` displays this article with a large "Hero" design, including a cover image gradient overlay and category badges.

### 2. Strapi v5 Integration

The application is tailored for Strapi v5's API structure:

- **Flatted Response**: We do not expect deeply nested `data.attributes`. The API client handles response types directly.
- **Dynamic Zones**: The `BlockRenderer` handles `shared.*` components (the new naming convention in our schema):
  - `shared.rich-text`
  - `shared.quote`
  - `shared.callout`
  - `shared.image`
  - `shared.embed`
  - `shared.code-block`

### 3. Pagination

- **Server-Side**: Pagination is handled via URL query parameters (`?page=2`).
- **Implementation**: `BlogListingPage` receives the `page` param and passes it to `getBlogPosts`.
- **UI**: The `<Pagination />` component automatically renders "Previous", "Next", and page numbers based on the `meta.pagination` data returned from Strapi. It auto-hides if there are fewer posts than the page size (10).

### 4. Error Handling

- **Graceful Degradation**: API calls are wrapped in `try/catch`. If Strapi is down or returns a 400/500, the page will not crash entirely but may show a safe fallback or a 404.
- **Custom 404**: A professional `src/app/not-found.tsx` page catches invalid slugs or missing content, providing users with wayfinding buttons to return home.

---

## 🎨 Design System

The blog uses a premium, "trust-first" design language suitable for a security verification platform.

### Typography & Layout

- **Font**: Uses **Geist Sans** for body text and headers for a clean, technical look.
- **Readability**: Blog post content is strictly constrained to `65ch` (characters) width to ensure optimal reading comfort.
- **Spacing**: Generous vertical spacing (`my-8`, `my-12`) separates content blocks clearly.

### Block Styling

- **Quotes**: Rendered with a large serif font and decorative quote icon.
- **Callouts**: Styled with semantic colors:
  - 🔵 **Info**: Blue background/border
  - 🟡 **Warning**: Amber background/border
  - 🟢 **Tip**: Emerald background/border
- **Code**: Dark-mode themed blocks with a macOS-style window header (red/yellow/green dots).

---

## 🛠️ Configuration

### API Connection

The blog connects to Strapi via environment variables:

- `NEXT_PUBLIC_STRAPI_API_URL`: The base URL of your Strapi instance (default: `http://localhost:1337`).
- `STRAPI_PREVIEW_SECRET`: For Preview Mode authentication.

### Adjusting Pagination

To change the number of posts per page, edit `src/app/blog/page.tsx`:

```typescript
const pageSize = 10; // Change this value
```

### Adding New Blocks

1.  **Strapi**: Add the component to your Dynamic Zone.
2.  **Types**: Update `src/types/blog.ts` to include the new component interface.
3.  **Renderer**: Add a new `case` in `src/components/blog/BlockRenderer.tsx` to handle the display logic.
