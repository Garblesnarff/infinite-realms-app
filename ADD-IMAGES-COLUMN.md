# Adding Images Column to dialogue_history Table

The application is failing because the `dialogue_history` table is missing the `images` column that stores generated scene images.

## How to Fix

### Method 1: Supabase Dashboard (Recommended)

1. Go to: https://app.supabase.com/project/cnalyhtalikwsopogula/sql/new
2. Copy and paste the SQL below:

```sql
-- Add images column to dialogue_history table to store generated scene images
ALTER TABLE dialogue_history
ADD COLUMN images JSONB DEFAULT '[]'::jsonb;

-- Create index for better query performance
CREATE INDEX idx_dialogue_history_images ON dialogue_history USING GIN (images);
```

3. Click the **Run** button
4. You should see "Query executed successfully"

### Verification asdfwaerafsdf asdfs 

After running the SQL, the images will automatically persist to messages. You should see:
- ✅ Scene images upload to Supabase storage
- ✅ PATCH request succeeds (no more 404)
- ✅ Images appear on messages
- ✅ Images persist after page refresh

### What This Does

- **Column Addition**: Adds a JSONB column to store an array of image objects
- **Default Value**: Initializes new rows with empty array `[]`
- **Index**: Creates a GIN index for efficient queries on the images array

### Schema

The `images` column will store objects like:
```json
[
  {
    "url": "https://...",
    "prompt": "...",
    "model": "google/gemini-2.5-flash-image-preview",
    "quality": "low",
    "createdAt": "2024-10-16T..."
  }
]
```
