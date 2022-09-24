import { hashOneShot } from '../base';
import { defaultHashLength, HashInput, IBaseHashOptions, inputToArray } from '../base/hash-fn';
import { createDeriveKey, createKeyed } from './hash-instance';

/**
 * Returns a blake3 hash of the input.
 */
export function hash(
  input: HashInput,
  { length = defaultHashLength }: IBaseHashOptions = {},
): Buffer {
  return Buffer.from(hashOneShot(inputToArray(input), length));
}

/**
 * Given cryptographic key material  and a context string, services a subkey of
 * any length. See {@link https://docs.rs/blake3/0.1.3/blake3/fn.derive_key.html}
 * for more information.
 */
export function deriveKey(
  context: HashInput,
  material: HashInput,
  { length = defaultHashLength }: IBaseHashOptions = {},
) {
  const derive = createDeriveKey(context);
  derive.update(inputToArray(material));
  const digest = derive.digest({ length });
  derive.dispose();
  return digest;
}

/**
 * The keyed hash function. See {@link https://docs.rs/blake3/0.1.3/blake3/fn.keyed_hash.html}.
 */
export function keyedHash(
  key: HashInput,
  input: HashInput,
  { length = defaultHashLength }: IBaseHashOptions = {},
) {
  const keyed = createKeyed(key);
  keyed.update(inputToArray(input));
  const digest = keyed.digest({ length });
  keyed.dispose();
  return digest;
}
