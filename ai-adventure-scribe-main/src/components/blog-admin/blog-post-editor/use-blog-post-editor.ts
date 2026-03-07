import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type { BlogPost, BlogPostStatus } from '@/types/blog';

import { useCreateBlogPost, useUpdateBlogPost } from '@/hooks/blog/useBlogPosts';
import { useBlogCategories, useBlogTags } from '@/hooks/blog/useBlogTaxonomy';
import { slugify } from '@/utils/slug';
import { generateExcerpt } from '@/utils/text-helpers';

export const blogPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase with hyphens'),
  excerpt: z.string().max(500, 'Excerpt must be 500 characters or less').optional(),
  content: z.string().min(1, 'Content is required'),
  coverImageUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  status: z.enum(['draft', 'scheduled', 'published']),
  scheduledFor: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  seoTitle: z.string().max(60, 'SEO title should be 60 characters or less').optional(),
  seoDescription: z
    .string()
    .max(160, 'SEO description should be 160 characters or less')
    .optional(),
  allowComments: z.boolean().default(true),
});

export type BlogPostFormValues = z.infer<typeof blogPostSchema>;

export interface UseBlogPostEditorProps {
  post?: BlogPost;
  onSuccess?: (post: BlogPost) => void;
  onCancel?: () => void;
}

export interface UseBlogPostEditorReturn {
  form: UseFormReturn<BlogPostFormValues>;
  isEditMode: boolean;
  mediaManagerOpen: boolean;
  setMediaManagerOpen: (open: boolean) => void;
  unsavedChanges: boolean;
  setUnsavedChanges: (unsaved: boolean) => void;
  showUnsavedDialog: boolean;
  setShowUnsavedDialog: (show: boolean) => void;
  previewUrl: string;
  setPreviewUrl: (url: string) => void;
  statusValue: BlogPostStatus;
  categoryOptions: { value: string; label: string }[];
  tagOptions: { value: string; label: string }[];
  isPending: boolean;
  handleAutoGenerateExcerpt: () => void;
  handleAutoGenerateSEO: () => void;
  handleSelectMedia: (url: string) => void;
  onSubmit: (values: BlogPostFormValues) => Promise<void>;
  handleCancel: () => void;
  handlePreview: () => void;
}

export function useBlogPostEditor({ post, onSuccess, onCancel }: UseBlogPostEditorProps): UseBlogPostEditorReturn {
  const isEditMode = !!post;
  const [mediaManagerOpen, setMediaManagerOpen] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const { data: categories = [] } = useBlogCategories();
  const { data: tags = [] } = useBlogTags();
  const createMutation = useCreateBlogPost();
  const updateMutation = useUpdateBlogPost(post?.id);
  const form = useForm<BlogPostFormValues>({
    resolver: zodResolver(blogPostSchema),
    defaultValues: {
      title: post?.title || '',
      slug: post?.slug || '',
      excerpt: post?.excerpt || '',
      content: post?.content || '',
      coverImageUrl: post?.coverImageUrl || '',
      status: (post?.status as BlogPostStatus) || 'draft',
      scheduledFor: post?.scheduledFor || '',
      categoryIds: post?.categoryIds || [],
      tagIds: post?.tagIds || [],
      seoTitle: post?.seoTitle || '',
      seoDescription: post?.seoDescription || '',
      allowComments: post?.allowComments ?? true,
    },
  });
  const titleValue = form.watch('title');
  const contentValue = form.watch('content');
  const statusValue = form.watch('status');
  useEffect(() => {
    if (!titleValue || form.formState.dirtyFields.slug) return;
    form.setValue('slug', slugify(titleValue), { shouldDirty: false });
  }, [titleValue, form]);
  useEffect(() => {
    const subscription = form.watch(() => setUnsavedChanges(true));
    return () => subscription.unsubscribe();
  }, [form]);
  const handleAutoGenerateExcerpt = (): void => {
    const excerpt = generateExcerpt(contentValue, 200);
    form.setValue('excerpt', excerpt, { shouldDirty: true, shouldValidate: true });
    toast.success('Excerpt generated from content');
  };
  const handleAutoGenerateSEO = (): void => {
    const title = form.getValues('title');
    const excerpt = form.getValues('excerpt') || generateExcerpt(contentValue, 160);
    if (!form.getValues('seoTitle')) form.setValue('seoTitle', title.substring(0, 60), { shouldDirty: true });
    if (!form.getValues('seoDescription')) form.setValue('seoDescription', excerpt.substring(0, 160), { shouldDirty: true });
    toast.success('SEO fields populated');
  };
  const handleSelectMedia = (url: string): void => {
    form.setValue('coverImageUrl', url, { shouldDirty: true, shouldValidate: true });
  };
  const onSubmit = async (values: BlogPostFormValues): Promise<void> => {
    try {
      const payload = {
        title: values.title,
        slug: values.slug,
        content: values.content,
        excerpt: values.excerpt || null,
        coverImageUrl: values.coverImageUrl || null,
        status: values.status,
        seoTitle: values.seoTitle || null,
        seoDescription: values.seoDescription || null,
        scheduledFor: values.scheduledFor || null,
        publishedAt: values.status === 'published' ? new Date().toISOString() : null,
        categoryIds: values.categoryIds || [],
        tagIds: values.tagIds || [],
        allowComments: values.allowComments,
      };
      if (isEditMode) {
        const updated = await updateMutation.mutateAsync(payload);
        toast.success('Blog post updated successfully');
        setUnsavedChanges(false);
        onSuccess?.(updated);
      } else {
        const created = await createMutation.mutateAsync(payload);
        toast.success('Blog post created successfully');
        setUnsavedChanges(false);
        onSuccess?.(created);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save blog post';
      toast.error(message);
    }
  };
  const handleCancel = (): void => {
    if (unsavedChanges) setShowUnsavedDialog(true);
    else onCancel?.();
  };
  const handlePreview = (): void => {
    const previewData = form.getValues();
    const queryParams = new URLSearchParams({ title: previewData.title, content: previewData.content, excerpt: previewData.excerpt || '', coverImageUrl: previewData.coverImageUrl || '' });
    setPreviewUrl(`/admin/blog/preview?${queryParams.toString()}`);
  };
  const categoryOptions = categories.map((cat) => ({ value: cat.id, label: cat.title || cat.name || cat.slug }));
  const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));
  const isPending = createMutation.isPending || updateMutation.isPending;
  return {
    form, isEditMode, mediaManagerOpen, setMediaManagerOpen, unsavedChanges, setUnsavedChanges,
    showUnsavedDialog, setShowUnsavedDialog, previewUrl, setPreviewUrl, statusValue, categoryOptions,
    tagOptions, isPending, handleAutoGenerateExcerpt, handleAutoGenerateSEO, handleSelectMedia,
    onSubmit, handleCancel, handlePreview,
  };
}
