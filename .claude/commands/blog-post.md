---
name: blog-post
description: Generate a comprehensive technical blog post about completed development work
---

Generate a technical blog post about: $ARGUMENTS

1. Review the latest phase or significant development milestone
2. Create a comprehensive blog post with:
   - **Compelling Title**: Focus on the technical challenge solved
   - **Hook**: Start with the specific problem or breakthrough
   - **Context**: Why this matters for persistent RPG worlds
   - **Technical Details**: Architecture decisions and implementation
   - **Code Examples**: Key components and patterns
   - **Performance Metrics**: Before/after numbers, optimization results
   - **Challenges**: What problems were solved and how
   - **Lessons Learned**: Unexpected discoveries and insights
   - **Results**: What works now that didn't before
   - **Next Steps**: What this enables for future development
3. Save to `docs/blog/technical/YYYY-MM-DD-[topic].md`
4. Include meta tags for dev.to publishing
5. Focus on your unique expertise in multi-agent AI for persistent worlds

Blog structure template:
```markdown
---
title: "[Phase]: [Technical Achievement]"
date: [DATE]
tags: ai, gamedev, dnd, multi-agent, persistent-worlds
cover_image: ./images/[topic]-hero.png
series: "Building AI Adventure Scribe"
---

## The Challenge

[What technical problem needed solving?]

## The Solution

[How you approached and solved it]

## Technical Implementation

[Architecture and code details]

## Performance Impact

[Metrics and improvements]

## Key Learnings

[Unexpected discoveries]

## What's Next

[How this enables future features]
```