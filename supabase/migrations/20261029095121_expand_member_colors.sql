-- Extend member colors while preserving all existing choices and policies.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_accent_color_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_accent_color_check CHECK (accent_color IS NULL OR accent_color IN ('blue', 'cyan', 'teal', 'green', 'lime', 'amber', 'orange', 'coral', 'red', 'violet', 'purple', 'pink', 'silver', 'sky', 'aqua', 'mint', 'emerald', 'olive', 'yellow', 'gold', 'peach', 'salmon', 'rose', 'fuchsia', 'lavender', 'indigo', 'periwinkle', 'slate'));
