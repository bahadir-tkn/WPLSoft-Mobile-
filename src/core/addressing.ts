import type { AddressRole, DevicePrefix, PlcModelId } from '../types/plc';
import { PLC_MODELS, SPECIAL_RELAYS } from './plcModels';

export interface ParsedAddress {
  raw: string;
  normalized: string;
  prefix: DevicePrefix;
  numericText: string;
  /** Decimal value (for X/Y this is the base-10 value of the octal index, e.g. X10 -> 8) */
  numericValue: number;
  isOctal: boolean;
  isSpecialRelay: boolean;
}

export interface AddressValidationResult {
  valid: boolean;
  parsed?: ParsedAddress;
  error?: string;
  warning?: string;
  ioZone?: 'onboard' | 'expansion' | 'internal' | 'special' | 'constant';
}

const VALID_PREFIXES = new Set<string>(['X', 'Y', 'M', 'T', 'C', 'D', 'K']);

/**
 * Converts a decimal index (0..15) into Delta octal notation string ('0'..'7', '10'..'17').
 */
export function decimalToOctalText(decimalIndex: number): string {
  if (!Number.isInteger(decimalIndex) || decimalIndex < 0) {
    throw new RangeError(`Geçersiz sekizlik indeks: ${decimalIndex}`);
  }
  return decimalIndex.toString(8);
}

/**
 * Returns the next Delta octal address (e.g., X7 -> X10, Y16 -> Y17).
 * When modelId is omitted, defaults to the 16-point 0o17 limit for compatibility;
 * when provided, respects PLC_MODELS[modelId].maxOctalIo.
 */
export function nextOctalAddress(address: string, modelId?: PlcModelId): string | null {
  const effectiveModel: PlcModelId = modelId ?? 'DVP-14SS2';
  const result = validateAddress(address, 'any', effectiveModel);
  if (!result.valid || !result.parsed || !result.parsed.isOctal) {
    return null;
  }
  const limit = modelId ? PLC_MODELS[modelId].maxOctalIo : 0o17;
  const nextDec = result.parsed.numericValue + 1;
  if (nextDec > limit) {
    return null;
  }
  return `${result.parsed.prefix}${decimalToOctalText(nextDec)}`;
}

/**
 * Enumerates valid Delta octal addresses from X0/Y0 to X17/Y17.
 */
export function enumerateOctalAddresses(prefix: 'X' | 'Y', maxOctal = 0o17): string[] {
  const list: string[] = [];
  for (let i = 0; i <= maxOctal; i += 1) {
    list.push(`${prefix}${decimalToOctalText(i)}`);
  }
  return list;
}

/**
 * Offsets a normalized Delta device address (e.g. offsetAddress('D10', 1) -> 'D11', offsetAddress('Y7', 1) -> 'Y10').
 */
export function offsetDeviceAddress(address: string, offset: number): string | null {
  const trimmed = address.trim().toUpperCase();
  const prefix = trimmed[0];
  const rest = trimmed.slice(1);
  if (!prefix || !/^\d+$/.test(rest)) return null;

  if (prefix === 'X' || prefix === 'Y') {
    if (/[89]/.test(rest)) return null;
    const base = Number.parseInt(rest, 8);
    const next = base + offset;
    if (Number.isNaN(next) || next < 0) return null;
    return `${prefix}${next.toString(8)}`;
  }

  if (prefix === 'M' || prefix === 'T' || prefix === 'C' || prefix === 'D') {
    const base = Number.parseInt(rest, 10);
    const next = base + offset;
    if (Number.isNaN(next) || next < 0) return null;
    return `${prefix}${next}`;
  }

  return null;
}

/**
 * Validates a ZRST S1 S2 zone reset pair (same writable prefix Y/M/T/C/D and S1 <= S2).
 */
export function validateZrstRange(
  startInput: string,
  endInput: string,
  modelId: PlcModelId = 'DVP-SX2'
): { valid: boolean; startNorm?: string; endNorm?: string; error?: string } {
  const resStart = validateAddress(startInput, 'rst_target', modelId);
  if (!resStart.valid || !resStart.parsed) {
    return { valid: false, error: `ZRST Başlangıç (S1): ${resStart.error}` };
  }
  const resEnd = validateAddress(endInput, 'rst_target', modelId);
  if (!resEnd.valid || !resEnd.parsed) {
    return { valid: false, error: `ZRST Bitiş (S2): ${resEnd.error}` };
  }
  if (resStart.parsed.prefix !== resEnd.parsed.prefix) {
    return {
      valid: false,
      error: `ZRST başlangıç (${resStart.parsed.normalized}) ve bitiş (${resEnd.parsed.normalized}) aygıt tipleri aynı olmalıdır.`,
    };
  }
  if (resStart.parsed.numericValue > resEnd.parsed.numericValue) {
    return {
      valid: false,
      error: `ZRST başlangıç adresi (${resStart.parsed.normalized}), bitiş adresinden (${resEnd.parsed.normalized}) büyük olamaz.`,
    };
  }
  return {
    valid: true,
    startNorm: resStart.parsed.normalized,
    endNorm: resEnd.parsed.normalized,
  };
}

/**
 * Validates and normalizes a Delta DVP device address or K constant according to Delta octal & range rules.
 */
export function validateAddress(
  input: string,
  role: AddressRole = 'any',
  modelId: PlcModelId = 'DVP-14SS2'
): AddressValidationResult {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Aygıt adresi boş bırakılamaz (örn. X0, Y0, M0, T0, C0, D0).',
    };
  }

  const prefix = trimmed[0];
  const rest = trimmed.slice(1);

  if (!VALID_PREFIXES.has(prefix)) {
    return {
      valid: false,
      error: `Geçersiz aygıt ön eki "${prefix}". Desteklenen ön ekler: X, Y, M, T, C, D, K.`,
    };
  }

  if (!rest) {
    return {
      valid: false,
      error: `"${prefix}" ön ekinden sonra geçerli bir adres numarası girilmelidir.`,
    };
  }

  const typedPrefix = prefix as DevicePrefix;
  const spec = PLC_MODELS[modelId];

  // Handle K constants
  if (typedPrefix === 'K') {
    if (!/^-?\d+$/.test(rest)) {
      return {
        valid: false,
        error: 'K sabiti geçerli bir tam sayı olmalıdır (örn. K50 veya K-10).',
      };
    }
    const value = Number.parseInt(rest, 10);
    if (role === 'preset') {
      if (value < 0 || value > 32767) {
        return {
          valid: false,
          error: 'Zamanlayıcı / Sayıcı K sabiti 0 ile 32767 arasında olmalıdır.',
        };
      }
    } else if (value < -32768 || value > 32767) {
      return {
        valid: false,
        error: '16-bit K sabiti -32768 ile 32767 arasında olmalıdır.',
      };
    }

    if (
      role === 'bit_contact' ||
      role === 'bit_coil' ||
      role === 'rst_target' ||
      role === 'timer' ||
      role === 'counter' ||
      role === 'word_dest'
    ) {
      return {
        valid: false,
        error: `K sabiti (${trimmed}) bu alan için kullanılamaz.`,
      };
    }

    return {
      valid: true,
      ioZone: 'constant',
      parsed: {
        raw: input,
        normalized: `K${value}`,
        prefix: 'K',
        numericText: String(value),
        numericValue: value,
        isOctal: false,
        isSpecialRelay: false,
      },
    };
  }

  // Non-K devices require unsigned digits
  if (!/^\d+$/.test(rest)) {
    return {
      valid: false,
      error: `"${trimmed}" adresinde geçersiz karakter bulunuyor. Yalnızca rakam kullanın.`,
    };
  }

  // Handle Octal X / Y inputs and outputs
  if (typedPrefix === 'X' || typedPrefix === 'Y') {
    if (/[89]/.test(rest)) {
      return {
        valid: false,
        error: `Delta PLC ${typedPrefix} adresleri sekizlik (octal) sistemdedir; 8 ve 9 rakamları kullanılamaz (${typedPrefix}7'den sonra ${typedPrefix}10 gelir).`,
      };
    }

    const octalValue = Number.parseInt(rest, 8);
    const maxOctal = spec.maxOctalIo;
    const maxOctalText = decimalToOctalText(maxOctal);
    if (Number.isNaN(octalValue) || octalValue < 0 || octalValue > maxOctal) {
      return {
        valid: false,
        error: `${typedPrefix} adresi ${spec.label} için sekizlik aralıkta ${typedPrefix}0 – ${typedPrefix}${maxOctalText} arasında olmalıdır.`,
      };
    }

    const canonicalNumber = decimalToOctalText(octalValue);
    const normalized = `${typedPrefix}${canonicalNumber}`;

    if ((role === 'bit_coil' || role === 'rst_target') && typedPrefix === 'X') {
      return {
        valid: false,
        error: `Fiziksel giriş (${normalized}) bobin (OUT/SET/RST) olarak sürülemez.`,
      };
    }
    if (
      role === 'timer' ||
      role === 'counter' ||
      role === 'preset' ||
      role === 'word_source' ||
      role === 'word_dest'
    ) {
      return {
        valid: false,
        error: `${normalized} bu komut parametresi için uygun değildir.`,
      };
    }

    const isOnboard =
      typedPrefix === 'X'
        ? spec.onboardInputs.includes(normalized)
        : spec.onboardOutputs.includes(normalized);

    return {
      valid: true,
      ioZone: isOnboard ? 'onboard' : 'expansion',
      warning: isOnboard
        ? undefined
        : `${normalized}, ${spec.label} üzerinde genişleme (expansion) I/O modülü adresidir.`,
      parsed: {
        raw: input,
        normalized,
        prefix: typedPrefix,
        numericText: canonicalNumber,
        numericValue: octalValue,
        isOctal: true,
        isSpecialRelay: false,
      },
    };
  }

  // Decimal device parsing for M, T, C, D
  const decValue = Number.parseInt(rest, 10);

  if (typedPrefix === 'M') {
    const normalized = `M${decValue}`;
    const special = SPECIAL_RELAYS[normalized];
    const inStandardRange = decValue >= spec.relayRange.min && decValue <= spec.relayRange.max;

    if (!inStandardRange && !special) {
      return {
        valid: false,
        error: `Yardımcı röle adresi ${spec.label} için M${spec.relayRange.min} – M${spec.relayRange.max} aralığında veya özel röle (M1000–M1003, M1011–M1014, M1020–M1022) olmalıdır.`,
      };
    }

    if (special && (role === 'bit_coil' || role === 'rst_target')) {
      return {
        valid: false,
        error: `${normalized} (${special.name}) salt okunur özel röledir; bobin olarak sürülemez.`,
      };
    }

    if (
      role === 'timer' ||
      role === 'counter' ||
      role === 'preset' ||
      role === 'word_source' ||
      role === 'word_dest'
    ) {
      return {
        valid: false,
        error: `${normalized} bu parametre alanı için uygun değildir.`,
      };
    }

    return {
      valid: true,
      ioZone: special ? 'special' : 'internal',
      parsed: {
        raw: input,
        normalized,
        prefix: 'M',
        numericText: String(decValue),
        numericValue: decValue,
        isOctal: false,
        isSpecialRelay: Boolean(special),
      },
    };
  }

  if (typedPrefix === 'T') {
    if (decValue < spec.timerRange.min || decValue > spec.timerRange.max) {
      return {
        valid: false,
        error: `Zamanlayıcı adresi T${spec.timerRange.min} – T${spec.timerRange.max} aralığında olmalıdır.`,
      };
    }
    const normalized = `T${decValue}`;
    if (role === 'bit_coil' || role === 'counter' || role === 'preset' || role === 'word_dest') {
      return {
        valid: false,
        error: `${normalized} bu alan için kullanılamaz.`,
      };
    }
    return {
      valid: true,
      ioZone: 'internal',
      parsed: {
        raw: input,
        normalized,
        prefix: 'T',
        numericText: String(decValue),
        numericValue: decValue,
        isOctal: false,
        isSpecialRelay: false,
      },
    };
  }

  if (typedPrefix === 'C') {
    if (decValue < spec.counterRange.min || decValue > spec.counterRange.max) {
      return {
        valid: false,
        error: `Sayıcı adresi C${spec.counterRange.min} – C${spec.counterRange.max} aralığında olmalıdır.`,
      };
    }
    const normalized = `C${decValue}`;
    if (role === 'bit_coil' || role === 'timer' || role === 'preset' || role === 'word_dest') {
      return {
        valid: false,
        error: `${normalized} bu alan için kullanılamaz.`,
      };
    }
    return {
      valid: true,
      ioZone: 'internal',
      parsed: {
        raw: input,
        normalized,
        prefix: 'C',
        numericText: String(decValue),
        numericValue: decValue,
        isOctal: false,
        isSpecialRelay: false,
      },
    };
  }

  // D registers
  if (decValue < spec.registerRange.min || decValue > spec.registerRange.max) {
    return {
      valid: false,
      error: `Veri registerı D${spec.registerRange.min} – D${spec.registerRange.max} aralığında olmalıdır.`,
    };
  }
  const normalized = `D${decValue}`;
  if (role === 'bit_contact' || role === 'bit_coil' || role === 'timer' || role === 'counter') {
    return {
      valid: false,
      error: `${normalized} veri registerıdır; bit kontağı/bobini yerine karşılaştırma (LD=..LD<>) veya MOV ile kullanılmalıdır.`,
    };
  }

  return {
    valid: true,
    ioZone: 'internal',
    parsed: {
      raw: input,
      normalized,
      prefix: 'D',
      numericText: String(decValue),
      numericValue: decValue,
      isOctal: false,
      isSpecialRelay: false,
    },
  };
}
