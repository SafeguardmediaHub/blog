/** biome-ignore-all lint/suspicious/noFallthroughSwitchClause: <> */

export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  preview: {
    enabled: true,
    config: {
      allowedOrigins: env('CLIENT_URL'),
      // …
      async handler(uid, { documentId, locale, status }) {
        const document = await strapi.documents(uid).findOne({ documentId });

        const pathname = getPreviewPathname(uid, { locale, document });

        if (!pathname) {
          return null;
        }

        const urlSearchParams = new URLSearchParams({
          url: pathname,
          secret: env('PREVIEW_SECRET'),
          status,
        });

        const clientUrl = env('CLIENT_URL');

        return `${clientUrl}/api/preview?${urlSearchParams}`;
      },
    },
  },
});

// Function to generate preview pathname based on content type and document
const getPreviewPathname = (uid, { locale, document }): string => {
  const { slug } = document;

  // Handle different content types with their specific URL patterns
  switch (uid) {
    // Handle pages with predefined routes
    case 'api::page.page':
      switch (slug) {
        case 'homepage':
          return `/${locale}`; // Localized homepage
        case 'pricing':
          return '/pricing'; // Pricing page
        case 'contact':
          return '/contact'; // Contact page
        case 'faq':
          return '/faq'; // FAQ page
      }
    // Handle product pages
    case 'api::product.product': {
      if (!slug) {
        return '/products'; // Products listing page
      }
      return `/products/${slug}`; // Individual product page
    }
    // Handle blog articles
    case 'api::article.article': {
      if (!slug) {
        return '/blog'; // Blog listing page
      }
      return `/blog/${slug}`; // Individual article page
    }
    default: {
      return null;
    }
  }
};

// … main export (see step 3)
