import { useState, useCallback, useEffect } from 'react';

import logger from '@/lib/logger';
import { isOffline } from '@/utils/network';

export type BlogRole = 'admin' | 'editor' | 'author' | 'contributor' | 'viewer';

interface UseBlogRoleProps {
  user: { id: string; email: string } | null;
}

/**
 * Hook to manage blog role state and fetching.
 * Extracted from AuthContext.
 */
export function useBlogRole({ user }: UseBlogRoleProps): {
  blogRole: BlogRole | null;
  blogRoleLoading: boolean;
  refreshBlogRole: () => Promise<void>;
  isBlogAdmin: boolean;
} {
  const [blogRole, setBlogRole] = useState<BlogRole | null>(null);
  const [blogRoleLoading, setBlogRoleLoading] = useState(false);

  const fetchBlogRole = useCallback(async () => {
    setBlogRoleLoading(true);
    try {
      // Check for separate blog admin token first (independent of WorkOS auth)
      const blogAdminToken =
        sessionStorage.getItem('blog_admin_token') || localStorage.getItem('blog_admin_token');
      if (blogAdminToken) {
        try {
          // Decode JWT to check expiration (server will verify signature)
          const payload = JSON.parse(atob(blogAdminToken.split('.')[1]));
          const now = Math.floor(Date.now() / 1000);
          if (payload.exp > now && payload.type === 'blog_admin' && payload.role === 'admin') {
            setBlogRole('admin');
            return;
          }
        } catch {
          // Invalid token, remove it
          sessionStorage.removeItem('blog_admin_token');
          localStorage.removeItem('blog_admin_token');
        }
      }

      // If no user is logged in via WorkOS, check is complete
      if (!user) {
        setBlogRole(null);
        setBlogRoleLoading(false);
        return;
      }

      if (isOffline()) {
        setBlogRoleLoading(false);
        return;
      }

      // Dev override: allow admin access in non-production without email setup
      const devAdminEmail = import.meta?.env?.VITE_DEV_BLOG_ADMIN_EMAIL as string | undefined;
      const devOverrideRaw = import.meta?.env?.VITE_BLOG_ADMIN_DEV_OVERRIDE as string | undefined;
      const isDev = import.meta?.env?.MODE !== 'production';
      const enableDevOverride =
        devOverrideRaw === 'true' ||
        devOverrideRaw === '1' ||
        (devOverrideRaw === undefined && !devAdminEmail);
      if (isDev && enableDevOverride) {
        setBlogRole('admin');
        return;
      }
      // If a specific dev admin email is set, grant admin for that user
      if (
        isDev &&
        devAdminEmail &&
        user.email &&
        user.email.toLowerCase() === devAdminEmail.toLowerCase()
      ) {
        setBlogRole('admin');
        return;
      }

      // Default to null if no admin access granted
      setBlogRole(null);
    } catch (error) {
      logger.warn('Failed to load blog role', error);
      setBlogRole(null);
    } finally {
      setBlogRoleLoading(false);
    }
  }, [user]);

  // Clear blog role when user logs out
  useEffect(() => {
    if (!user) {
      setBlogRole(null);
      setBlogRoleLoading(false);
    }
  }, [user]);

  // Check blog role on mount (for blog admin token) and when user changes
  useEffect(() => {
    fetchBlogRole();
  }, [user?.id, fetchBlogRole]);

  // Re-check blog role when localStorage changes (for blog admin login/logout)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === 'blog_admin_token') {
        fetchBlogRole();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [fetchBlogRole]);

  return {
    blogRole,
    blogRoleLoading,
    refreshBlogRole: fetchBlogRole,
    isBlogAdmin: blogRole === 'admin',
  };
}
