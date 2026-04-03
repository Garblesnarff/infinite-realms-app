import { Edit, Eye, Loader2, Trash2, Undo2, Upload } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { BlogStatusBadge } from './blog-status-badge';

import type { BlogPost } from '@/types/blog';

import { Button } from '@/components/ui/button';

interface BlogPostsMobileListProps {
  posts: BlogPost[];
  categoryLookup: Map<string, string>;
  isActionPending: (postId: string) => boolean;
  onNavigate: (path: string) => void;
  onPublish: (post: BlogPost) => Promise<void>;
  onUnpublish: (post: BlogPost) => Promise<void>;
  onDelete: (post: BlogPost) => void;
  renderTagBadges: (tagIds?: string[]) => React.ReactNode;
  safeFormatDate: (value?: string | null) => string;
}

export const BlogPostsMobileList: React.FC<BlogPostsMobileListProps> = ({
  posts,
  categoryLookup,
  isActionPending,
  onNavigate,
  onPublish,
  onUnpublish,
  onDelete,
  renderTagBadges,
  safeFormatDate,
}) => {
  return (
    <div className="grid gap-3 md:hidden">
      {posts.map((post) => {
        const categoryName = post.categoryIds?.map((id) => categoryLookup.get(id)).find(Boolean);
        const isPending = isActionPending(post.id);
        return (
          <div key={post.id} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium leading-tight">{post.title || 'Untitled post'}</p>
                <p className="text-xs text-muted-foreground">/{post.slug}</p>
              </div>
              <BlogStatusBadge status={post.status} />
            </div>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Updated</span>
                <span>{safeFormatDate(post.updatedAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Category</span>
                <span>{categoryName ?? '—'}</span>
              </div>
              <div className="flex flex-wrap gap-1">{renderTagBadges(post.tagIds)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => onNavigate(`/admin/blog/edit/${post.id}`)}
                disabled={isPending}
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  if (post.status !== 'published') {
                    toast.info('Post must be published to view on the public blog. Click Publish first.');
                  } else {
                    window.open(`https://blog.infiniterealms.app/${post.slug}`, '_blank', 'noopener');
                  }
                }}
                disabled={isPending}
              >
                <Eye className="mr-2 h-4 w-4" />
                View
              </Button>
              {post.status === 'published' ? (
                <Button variant="outline" size="sm" className="flex-1" onClick={() => onUnpublish(post)} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
                  Unpublish
                </Button>
              ) : post.status !== 'archived' ? (
                <Button variant="outline" size="sm" className="flex-1" onClick={() => onPublish(post)} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Publish
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" className="flex-1" onClick={() => onDelete(post)} disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Delete
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
