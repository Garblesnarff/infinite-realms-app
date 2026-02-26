import { FileText, FolderTree, Tags, Image, LogOut } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

import { clearBlogAdminToken } from './BlogAdminLogin';

import { BlogCategoryManager } from '@/components/blog-admin/blog-category-manager';
import { BlogMediaManager } from '@/components/blog-admin/blog-media-manager';
import { BlogPostsList } from '@/components/blog-admin/blog-posts-list';
import { BlogTagManager } from '@/components/blog-admin/blog-tag-manager';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';

const BlogAdmin: React.FC = () => {
  const { isBlogAdmin, refreshBlogRole } = useAuth();

  const handleLogout = () => {
    clearBlogAdminToken();
    // Trigger re-check of blog role
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'blog_admin_token',
        newValue: null,
      }),
    );
    refreshBlogRole();
  };

  if (!isBlogAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <div className="w-full max-w-md rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <h1 className="mb-2 text-xl font-semibold text-destructive">Access Denied</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Blog admin privileges are required to access this area.
          </p>
          <Link to="/admin/blog/login">
            <Button variant="outline">Sign In to Blog Admin</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header
        className="sticky top-0 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ zIndex: Z_INDEX.STICKY }}
      >
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <span className="font-semibold">Blog Admin</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Blog Administration</h1>
          <p className="mt-2 text-muted-foreground">
            Manage posts, categories, tags, and media for the Infinite Realms blog.
          </p>
        </div>

        <Tabs defaultValue="posts" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:grid-cols-4">
            <TabsTrigger value="posts" className="gap-2">
              <FileText className="h-4 w-4" />
              Posts
            </TabsTrigger>
            <TabsTrigger value="categories" className="gap-2">
              <FolderTree className="h-4 w-4" />
              Categories
            </TabsTrigger>
            <TabsTrigger value="tags" className="gap-2">
              <Tags className="h-4 w-4" />
              Tags
            </TabsTrigger>
            <TabsTrigger value="media" className="gap-2">
              <Image className="h-4 w-4" />
              Media
            </TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="space-y-4">
            <BlogPostsList />
          </TabsContent>

          <TabsContent value="categories" className="space-y-4">
            <BlogCategoryManager />
          </TabsContent>

          <TabsContent value="tags" className="space-y-4">
            <BlogTagManager />
          </TabsContent>

          <TabsContent value="media" className="space-y-4">
            <BlogMediaManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default BlogAdmin;
