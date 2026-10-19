/** The story-rest claim found an event for this character, session, and player message. */
export class StoryRestAlreadyRecorded extends Error {
  constructor() {
    super('story rest already recorded for this player message');
    this.name = 'StoryRestAlreadyRecorded';
  }
}
