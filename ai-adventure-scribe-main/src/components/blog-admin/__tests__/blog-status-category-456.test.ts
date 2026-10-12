import { describe, expect, it } from 'vitest';

import { blogPostSchema } from '../blog-post-editor/use-blog-post-editor';
import { blogCategoryLabel } from '../blog-posts-list';

const base = { title: 'A post', slug: 'a-post', content: 'Body' };

describe('blog admin (#456)', () => {
  it.each(['draft', 'review', 'scheduled', 'published', 'archived'])(
    'the editor form accepts status %s, so saving keeps it',
    (status) => {
      expect(blogPostSchema.safeParse({ ...base, status }).success).toBe(true);
    },
  );

  it('labels a category by title, then name, then slug', () => {
    expect(blogCategoryLabel({ slug: 's', title: 'T', name: 'N' })).toBe('T');
    expect(blogCategoryLabel({ slug: 's', name: 'N' })).toBe('N');
    expect(blogCategoryLabel({ slug: 's' })).toBe('s');
  });
});
