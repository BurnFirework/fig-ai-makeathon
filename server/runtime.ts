import { RequestSchema } from '../shared/schema'

export function parseAgentRequest(value: unknown) {
  const request = RequestSchema.parse(value)
  if (request.operation === 'connect' && request.branches.length !== 2) throw new Error('Choose two different branches.')
  if (request.branches.length === 2 && request.branches[0]?.id === request.branches[1]?.id) throw new Error('Choose two different branches.')
  if (request.image && !/^data:image\/(png|jpeg|webp);base64,/.test(request.image)) throw new Error('Unsupported image.')
  return request
}
