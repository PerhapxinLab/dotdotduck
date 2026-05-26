/**
 * useForm — React hook for declarative forms with validation.
 *
 * Inspired by the form/validation patterns common in design systems but
 * built minimally — no external dep, ~80 LOC.
 *
 * - blur to validate
 * - change to clear error
 * - submit blocked while any field has error
 * - drafts auto-persist to dddk storage when given a `draftKey`
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StorageAdapter } from '../../types';
import { sdkString } from '../../utils/sdk-i18n';

export type FieldValidator<T> = (value: T) => string | undefined | null;

export interface FormFieldConfig<T> {
  initial: T;
  validate?: FieldValidator<T>;
  required?: boolean | string;
}

export interface UseFormOptions<V extends Record<string, unknown>> {
  fields: { [K in keyof V]: FormFieldConfig<V[K]> };
  onSubmit: (values: V) => void | boolean | Promise<void | boolean>;
  /** Persist half-filled values across reloads. */
  draftKey?: string;
  storage?: StorageAdapter;
  /** Locale for the bundled "field required" error message. `en` /
   *  `zh-TW` ship bundled. Pass a string on a field's `required` to
   *  override per-field. Default `en`. */
  locale?: string;
}

export interface FormFieldProps<T> {
  value: T;
  onChange: (value: T) => void;
  onBlur: () => void;
  error?: string;
}

export interface UseFormReturn<V extends Record<string, unknown>> {
  values: V;
  errors: Partial<Record<keyof V, string>>;
  setField<K extends keyof V>(name: K, value: V[K]): void;
  reset(): void;
  handleSubmit: () => Promise<void>;
  isSubmitting: boolean;
  isValid: boolean;
  field<K extends keyof V>(name: K): FormFieldProps<V[K]>;
}

export function useForm<V extends Record<string, unknown>>(
  options: UseFormOptions<V>
): UseFormReturn<V> {
  const storageRef = useRef(options.storage);
  storageRef.current = options.storage;

  const initialValues = useMemo(() => {
    const v: Partial<V> = {};
    for (const k in options.fields) {
      v[k] = options.fields[k]!.initial;
    }
    // Load draft if available
    if (options.draftKey && options.storage) {
      const raw = options.storage.get(`form-draft.${options.draftKey}`);
      if (raw && typeof raw === 'string') {
        try {
          Object.assign(v, JSON.parse(raw));
        } catch {
          /* ignore corrupt draft */
        }
      }
    }
    return v as V;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [values, setValues] = useState<V>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof V, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Draft persistence — debounced
  useEffect(() => {
    if (!options.draftKey || !storageRef.current) return;
    const t = setTimeout(() => {
      storageRef.current?.set(`form-draft.${options.draftKey}`, JSON.stringify(values));
    }, 300);
    return () => clearTimeout(t);
  }, [values, options.draftKey]);

  const setField = useCallback(<K extends keyof V>(name: K, value: V[K]) => {
    setValues((cur) => ({ ...cur, [name]: value }));
    setErrors((cur) => ({ ...cur, [name]: undefined }));
  }, []);

  const validateField = useCallback(
    <K extends keyof V>(name: K, value: V[K]): string | undefined => {
      const cfg = options.fields[name];
      if (!cfg) return undefined;
      if (cfg.required) {
        const empty = value === undefined || value === null || value === '';
        if (empty) {
          return typeof cfg.required === 'string' ? cfg.required : sdkString(options.locale, 'form.required');
        }
      }
      if (cfg.validate) {
        const result = cfg.validate(value);
        if (result) return result;
      }
      return undefined;
    },
    [options.fields]
  );

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
  }, [initialValues]);

  const handleSubmit = useCallback(async () => {
    // Validate all fields first
    const newErrors: Partial<Record<keyof V, string>> = {};
    let hasError = false;
    for (const k in options.fields) {
      const err = validateField(k as keyof V, values[k as keyof V]);
      if (err) {
        newErrors[k as keyof V] = err;
        hasError = true;
      }
    }
    setErrors(newErrors);
    if (hasError) return;

    setIsSubmitting(true);
    try {
      const result = await options.onSubmit(values);
      // If submit returns false, keep form values (caller chose not to clear).
      if (result !== false && options.draftKey && storageRef.current) {
        storageRef.current.remove(`form-draft.${options.draftKey}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [values, options, validateField]);

  const isValid = useMemo(() => Object.values(errors).every((e) => !e), [errors]);

  const field = useCallback(
    <K extends keyof V>(name: K): FormFieldProps<V[K]> => ({
      value: values[name],
      onChange: (v: V[K]) => setField(name, v),
      onBlur: () => {
        const err = validateField(name, values[name]);
        if (err) setErrors((cur) => ({ ...cur, [name]: err }));
      },
      error: errors[name],
    }),
    [values, errors, setField, validateField]
  );

  return {
    values,
    errors,
    setField,
    reset,
    handleSubmit,
    isSubmitting,
    isValid,
    field,
  };
}
