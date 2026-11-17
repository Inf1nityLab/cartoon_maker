import { z } from 'zod';

/** Понятные русские сообщения: их читает ИИ и исправляет код. Побочный эффект при импорте — один раз на процесс. */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'too_big':
        return iss.origin === 'number' ? `должен быть не больше ${String(iss.maximum)}` : `слишком длинное (максимум ${String(iss.maximum)})`;
      case 'too_small':
        return iss.origin === 'number' ? `должен быть не меньше ${String(iss.minimum)}` : `слишком короткое (минимум ${String(iss.minimum)})`;
      case 'invalid_type':
        return `ожидался тип ${iss.expected}`;
      case 'invalid_value':
        return `допустимые значения: ${(iss.values ?? []).map((v) => JSON.stringify(v)).join(', ')}`;
      case 'unrecognized_keys':
        return `лишние поля: ${(iss.keys ?? []).join(', ')}`;
      default:
        return undefined;
    }
  },
});
