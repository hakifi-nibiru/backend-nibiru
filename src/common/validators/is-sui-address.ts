import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';
import { isValidSuiAddress } from '@mysten/sui.js/utils';

export const IS_NIBIRU_ADDRESS = 'isNibiruAddress';

export function isNibiruAddress(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return value.startsWith("nibi");
  } catch (error) {
    return false;
  }
}

export function IsSuiAddress(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_NIBIRU_ADDRESS,
      validator: {
        validate: (value, args): boolean => isNibiruAddress(value),
        defaultMessage: buildMessage(
          (eachPrefix) => eachPrefix + '$property must be a nibiru address',
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
