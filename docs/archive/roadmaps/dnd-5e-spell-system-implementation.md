# D&D 5E Spell System Implementation - Character Creation Fix

You are tasked with implementing proper D&D 5th Edition spell and cantrip restrictions in the character creation process. Currently, ALL spells are available to ANY spellcasting class, which violates D&D 5E rules.

## CRITICAL REQUIREMENTS

### Primary Objective
Fix the character creation process to properly restrict spells and cantrips based on D&D 5E class rules, including:
- Class-specific spell lists
- Proper cantrip progression by class and level
- Spell slot progression matching official tables
- Spells known vs. spells prepared mechanics
- Level requirements for spell access
- Spell component requirements (V, S, M)
- Ritual casting rules
- Multiclassing spell slot calculation

### Sub-agent Strategy
You have access to specialized sub-agents via the Task tool. **USE THESE PROACTIVELY** throughout your work:

1. **dnd-rules-expert**: For D&D 5E rules research and validation
2. **database-schema-analyst**: For database structure analysis and design
3. **frontend-components-specialist**: For UI component implementation
4. **game-logic-engineer**: For game mechanics and rule logic

**IMPORTANT**: Launch sub-agents in PARALLEL when possible using multiple Task tool calls in a single response.

## IMPLEMENTATION ROADMAP

### Phase 1: Comprehensive Analysis (Use sub-agents immediately)
Launch all four analysis tasks in parallel:
- **Task 1**: Use `dnd-rules-expert` to research complete D&D 5E spellcasting rules for ALL classes
- **Task 2**: Use `database-schema-analyst` to analyze current spell/class data structure
- **Task 3**: Use `frontend-components-specialist` to analyze character creation UI components
- **Task 4**: Use `game-logic-engineer` to identify current spell selection logic

### Phase 2: Database Schema Design
- Design proper spell-class relationship tables
- Create spell progression tables (cantrips known, spells known/prepared by level)
- Implement class-specific spell lists with proper relationships
- Add spell level and component requirements
- Design multiclassing spell slot calculation tables
- Create migration strategy for existing data

### Phase 3: Backend Logic Implementation
- Implement spell filtering algorithms by class and level
- Add cantrip progression calculation logic
- Create spell slot progression calculation (including multiclassing)
- Build comprehensive validation for character creation
- Implement ritual casting logic
- Add spell component validation
- Create spellbook mechanics for wizards

### Phase 4: Frontend Implementation
- Update spell selection components with class-based filtering
- Add dynamic spell and cantrip limit displays
- Create proper spell progression indicators
- Implement spell component requirement display
- Build spellcasting focus selection interface
- Add ritual spell indicators
- Create multiclass spell slot calculator UI

### Phase 5: Testing & Validation
- Test each class's spell progression individually
- Validate against official D&D 5E rules and tables
- Test multiclassing spell slot calculations
- Ensure proper ritual casting implementation
- Validate spell component requirements
- Test edge cases and class-specific features

## COMPREHENSIVE D&D 5E SPELLCASTING RULES

### Full Casters (9th level spells, full progression)
- **Wizard**: Spellbook system, prepares spells, Intelligence-based, ritual casting from spellbook
- **Sorcerer**: Spells known system, Charisma-based, metamagic, limited flexibility
- **Cleric**: Prepares spells from entire cleric list, Wisdom-based, domain spells always prepared, ritual casting
- **Bard**: Spells known, Charisma-based, magical secrets for cross-class spells, ritual casting
- **Druid**: Prepares spells from entire druid list, Wisdom-based, ritual casting
- **Warlock**: Pact magic (unique system), Charisma-based, short rest recovery, all slots same level

### Half Casters (5th level spells max, starts at level 2)
- **Paladin**: Prepares spells, Charisma-based, divine smite, oath spells always prepared
- **Ranger**: Spells known, Wisdom-based, hunter's mark always prepared

### Third Casters (4th level spells max)
- **Eldritch Knight Fighter**: Spells known, Intelligence-based, limited to evocation/abjuration + any school choices
- **Arcane Trickster Rogue**: Spells known, Intelligence-based, limited to illusion/enchantment + any school choices

### Non-Casters (unless subclass provides)
- **Fighter, Rogue, Barbarian**: Only specific subclasses gain limited spellcasting

## CRITICAL TECHNICAL IMPLEMENTATION DETAILS

### 1. Spell Component System
Implement three component types:
- **Verbal (V)**: Require ability to speak (not silenced/gagged)
- **Somatic (S)**: Require free hand (or hand with spellcasting focus for spells with material components)
- **Material (M)**: Require component pouch, spellcasting focus, or specific components
- **Special Rules**: Costly components must be provided exactly, consumed components are used up

### 2. Spellcasting Focus vs Component Pouch
- **Spellcasting Focus**: Class-specific (wand, crystal, staff, etc.)
- **Component Pouch**: Universal material component substitute
- **Both**: Can replace material components without cost
- **Exception**: Cannot replace costly (gold value) or consumed components

### 3. Ritual Casting Implementation
- **Casting Time**: +10 minutes to normal casting time
- **No Spell Slot**: Ritual casting doesn't consume spell slots
- **Class Requirements**:
  - **Wizard**: Must have ritual spell in spellbook (doesn't need to be prepared)
  - **Cleric/Druid**: Must have ritual spell prepared
  - **Bard**: Must have ritual spell known

### 4. Multiclassing Spell Slot Calculation
```
Caster Level =
  Full Caster Levels +
  (Half Caster Levels ÷ 2, rounded down) +
  (Third Caster Levels ÷ 3, rounded down)

Warlock Pact Magic slots are separate but interchangeable
```

### 5. Starting Equipment and Spells (Level 1)
- **Hit Points**: Max hit die + Constitution modifier
- **Cantrips**: Class-specific number at level 1
- **1st Level Spells**: Class-specific known/prepared at level 1
- **Spellcasting Focus**: Must be acquired through starting equipment or gold
- **Component Pouch**: Alternative to spellcasting focus

### 6. Spell Preparation vs Spells Known
- **Prepared Casters** (Wizard, Cleric, Druid, Paladin): Choose daily from larger list
  - Number prepared = Spellcasting Ability Modifier + Class Level (minimum 1)
- **Known Casters** (Sorcerer, Bard, Ranger, Warlock, EK, AT): Fixed list that changes on level up
  - Specific number per class table

### 7. Class-Specific Special Rules
- **Wizard Spellbook**: Learn 2 spells per level, can copy found spells, ritual casting from book
- **Cleric Domain Spells**: Always prepared, don't count against preparation limit
- **Sorcerer Metamagic**: Modify spells with sorcery points
- **Warlock Pact Magic**: All slots same level, recover on short rest
- **Paladin Divine Smite**: Convert spell slots to radiant damage
- **Bard Magical Secrets**: Learn spells from any class at specific levels

## DATABASE SCHEMA REQUIREMENTS

### Core Tables
```sql
-- Classes with spellcasting information
classes (id, name, spellcasting_ability, caster_type, spell_slots_start_level)

-- All spells with components and details
spells (id, name, level, school, components, ritual, concentration, casting_time, range, duration, description)

-- Class spell lists (which spells each class can access)
class_spells (class_id, spell_id, spell_level, source_feature)

-- Spell slot progression by class and level
spell_progression (class_id, level, cantrips_known, spell_slots_1, spell_slots_2, ..., spell_slots_9, spells_known, spells_prepared_formula)

-- Multiclassing spell slot table
multiclass_spell_slots (caster_level, spell_slots_1, spell_slots_2, ..., spell_slots_9)

-- Character spell selections
character_spells (character_id, spell_id, is_prepared, source_class, source_feature)
```

### Key Relationships
- Classes → Spell Lists (many-to-many through class_spells)
- Classes → Spell Progression (one-to-many)
- Characters → Known/Prepared Spells (many-to-many through character_spells)
- Spells → Components (stored as flags or separate table)

## UI/UX REQUIREMENTS

### Spell Selection Interface
- **Class Filter**: Only show spells available to selected class
- **Level Filter**: Only show spells for available spell levels
- **Component Display**: Show V, S, M requirements clearly
- **Ritual Indicator**: Mark ritual spells with special icon
- **Selection Limits**: "X of Y" counters for cantrips, known spells, prepared spells
- **Real-time Validation**: Immediate feedback on invalid selections

### Character Sheet Integration
- **Spell Slot Tracker**: Visual representation of available slots by level
- **Prepared Spell List**: Easy preparation interface for applicable classes
- **Cantrip List**: Separate section for at-will spells
- **Spellcasting Focus**: Equipment tracking for focuses and component pouches
- **Multiclass Calculator**: Automatic spell slot calculation for multiclass characters

## SUCCESS CRITERIA

### Functional Requirements
- [x] Character creation only shows appropriate spells for selected class
- [ ] Cantrip limits enforced by class and level progression
- [ ] Spell slot progression matches D&D 5E tables exactly
- [ ] Level restrictions prevent access to higher-level spells
- [ ] Ritual casting properly implemented with class-specific rules
- [ ] Spell components tracked and validated
- [x] Multiclassing spell slots calculated correctly
- [ ] Spellcasting focus and component pouch mechanics working

### Technical Requirements
- [ ] Database schema supports all D&D 5E spellcasting mechanics
- [x] API endpoints provide proper spell filtering
- [x] UI components are reusable and maintainable
- [x] Real-time validation prevents invalid character states
- [x] Performance optimized for character creation workflow
- [ ] Migration strategy preserves existing character data

### Rule Compliance
- [ ] All 13 base classes properly implemented
- [ ] Official spell lists match D&D 5E sources exactly
- [ ] Spell progression tables match official rules
- [x] Multiclassing rules follow PHB calculations
- [ ] Ritual casting follows class-specific requirements
- [ ] Component requirements properly enforced

## EXECUTION NOTES

### Development Strategy
- **Start immediately** with parallel sub-agent tasks for comprehensive analysis
- **Use TodoWrite tool** to track progress throughout implementation
- **Focus on accuracy** - D&D rules are complex and specific, validate against official sources
- **Test incrementally** - validate each class individually before moving to next
- **Document changes** - explain rule violations being fixed and implementation decisions

### Common Pitfalls to Avoid
- **Warlock Confusion**: Pact Magic ≠ Spellcasting (separate systems that can interoperate)
- **Multiclass Rounding**: Different classes contribute differently to caster level
- **Ritual Requirements**: Classes have different rules for ritual casting
- **Component Exceptions**: Some spells require specific costly components
- **Preparation vs Known**: Don't mix up these fundamentally different systems

### Validation Sources
- **Primary**: D&D 5E Player's Handbook (PHB)
- **Secondary**: System Reference Document (SRD)
- **Online**: D&D Beyond, Roll20 Compendium for reference
- **Tools**: Online multiclass calculators for validation

Begin implementation by launching all four analysis sub-agents in parallel to gather comprehensive information about the current system and complete D&D 5E requirements.