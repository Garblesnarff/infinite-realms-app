import { ArrowUpDown, ChevronDown, ChevronUp, Edit, Eye, Loader2, Trash2, Undo2, Upload } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { BlogStatusBadge } from './blog-status-badge';

import type { BlogPost, BlogPostListFilters, SortField } from '@/types/blog';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface BlogPostsTableProps {
  posts: BlogPost[];
  filters: BlogPostListFilters;
  handleSort: (field: SortField) => void;
  categoryLookup: Map<string, string>;
  isActionPending: (postId: string) => boolean;
  onNavigate: (path: string) => void;
  onPublish: (post: BlogPost) => Promise<void>;
  onUnpublish: (post: BlogPost) => Promise<void>;
  onDelete: (post: BlogPost) => void;
  renderTagBadges: (tagIds?: string[]) => React.ReactNode;
  safeFormatDate: (value?: string | null) => string;
}

export const BlogPostsTable: React.FC<BlogPostsTableProps> = ({
  posts,
  filters,
  handleSort,
  categoryLookup,
  isActionPending,
  onNavigate,
  onPublish,
  onUnpublish,
  onDelete,
  renderTagBadges,
  safeFormatDate,
}) => {
  const SortIcon = ({ field }: { field: SortField }) => {
    if (filters.sortBy !== field) {
      return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" aria-hidden />;
    }
    return filters.sortDirection === 'asc' ? (
      <ChevronUp className="ml-2 h-4 w-4" aria-hidden />
    ) : (
      <ChevronDown className="ml-2 h-4 w-4" aria-hidden />
    );
  };

  return (
    <div className="hidden md:block">
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-8 font-semibold"
                  onClick={() => handleSort('title')}
                >
                  Title
                  <SortIcon field="title" />
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-8 font-semibold"
                  onClick={() => handleSort('status')}
                >
                  Status
                  <SortIcon field="status" />
                </Button>
              </TableHead>
              <TableHead className="w-40">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-8 font-semibold"
                  onClick={() => handleSort('updatedAt')}
                >
                  Updated
                  <SortIcon field="updatedAt" />
                </Button>
              </TableHead>
              <TableHead className="hidden lg:table-cell">Category</TableHead>
              <TableHead className="hidden lg:table-cell">Tags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.map((post) => {
              const categoryName = post.categoryIds
                ?.map((id) => categoryLookup.get(id))
                .find(Boolean);
              const isPending = isActionPending(post.id);
              return (
                <TableRow key={post.id} data-state={isPending ? 'loading' : undefined}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium leading-tight">{post.title || 'Untitled post'}</span>
                      <span className="text-xs text-muted-foreground">/{post.slug}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <BlogStatusBadge status={post.status} />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{safeFormatDate(post.updatedAt)}</span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {categoryName ? (
                      <Badge variant="outline" className="text-xs">
                        {categoryName}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{renderTagBadges(post.tagIds)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigate(`/admin/blog/edit/${post.id}`)}
                        aria-label={`Edit ${post.title}`}
                        disabled={isPending}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (post.status !== 'published') {
                            toast.info('Post must be published to view on the public blog. Click Publish first.');
                          } else {
                            window.open(`https://blog.infiniterealms.app/${post.slug}`, '_blank', 'noopener');
                          }
                        }}
                        aria-label={`View ${post.title} on blog`}
                        disabled={isPending}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {post.status === 'published' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onUnpublish(post)}
                          aria-label={`Unpublish ${post.title}`}
                          disabled={isPending}
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                        </Button>
                      ) : post.status !== 'archived' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onPublish(post)}
                          aria-label={`Publish ${post.title}`}
                          disabled={isPending}
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(post)}
                        aria-label={`Delete ${post.title}`}
                        className="text-destructive hover:text-destructive"
                        disabled={isPending}
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
