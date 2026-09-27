import type { DecisionQuestion, DecisionsRequest } from './decisions-types';

export class RequestShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestShapeError';
  }
}

function assertQuestion(name: string, question: DecisionQuestion): void {
  if (question.type === 'noul') {
    if (question.criteria) {
      if (question.criteria.true === undefined || question.criteria.false === undefined) {
        throw new RequestShapeError(`questions.${name}: noul criteria needs both true and false`);
      }
    }
    return;
  }
  if (question.type === 'choice') {
    const keys = Object.keys(question.criteria ?? {});
    if (keys.length < 1) {
      throw new RequestShapeError(`questions.${name}: choice criteria are required`);
    }
    if (keys.length > 255) {
      throw new RequestShapeError(`questions.${name}: choice allows at most 255 options`);
    }
    return;
  }
  if (question.type === 'score') {
    if (!Array.isArray(question.criteria)) {
      throw new RequestShapeError(`questions.${name}: score criteria must be an array`);
    }
    if (question.criteria.length < 1 || question.criteria.length > 10) {
      throw new RequestShapeError(`questions.${name}: score allows 1 to 10 levels`);
    }
    return;
  }
  throw new RequestShapeError(`questions.${name}: type must be noul, choice, or score`);
}

/** Local schema checks. A bad body never leaves the machine. */
export function assertDecisionsRequest(request: DecisionsRequest): void {
  if (!request.model) {
    throw new RequestShapeError('model is required');
  }
  if (request.state === undefined || request.state === null) {
    throw new RequestShapeError('state is required');
  }
  const names = Object.keys(request.questions ?? {});
  if (names.length < 1) {
    throw new RequestShapeError('At least one question is required');
  }
  for (const name of names) {
    assertQuestion(name, request.questions[name]);
  }
}
