import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

export function parseStoredTags(value, { splitSpaces = false } = {}) {
  if (!value?.trim()) return [];
  const parts = value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (splitSpaces && parts.length === 1) {
    return parts[0].split(/\s+/).filter(Boolean);
  }
  return parts;
}

function joinTags(tags) {
  return tags.join(', ');
}

function parseInputText(text) {
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeTags(existing, incoming) {
  const lower = new Set(existing.map((t) => t.toLowerCase()));
  const next = [...existing];
  incoming.forEach((tag) => {
    const key = tag.toLowerCase();
    if (!lower.has(key)) {
      lower.add(key);
      next.push(tag);
    }
  });
  return next;
}

export default function TagInput({
  value = '',
  onChange,
  placeholder = 'Type and press Enter',
  splitSpacesOnLoad = false,
  required = false,
  ringClass = 'focus-within:ring-purple-500',
  chipClass = 'bg-purple-50 border-purple-200 text-purple-900',
}) {
  const [tags, setTags] = useState(() => parseStoredTags(value, { splitSpaces: splitSpacesOnLoad }));
  const [inputValue, setInputValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const skipValueSync = useRef(false);

  useEffect(() => {
    if (skipValueSync.current) {
      skipValueSync.current = false;
      return;
    }
    setTags(parseStoredTags(value, { splitSpaces: splitSpacesOnLoad }));
  }, [value, splitSpacesOnLoad]);

  const emitChange = useCallback(
    (nextTags) => {
      skipValueSync.current = true;
      setTags(nextTags);
      onChange?.(joinTags(nextTags));
    },
    [onChange],
  );

  const commitInput = useCallback(
    (raw = inputValue) => {
      const parsed = parseInputText(raw);
      if (parsed.length === 0) return;
      emitChange(dedupeTags(tags, parsed));
      setInputValue('');
    },
    [inputValue, tags, emitChange],
  );

  const removeTag = (index) => {
    const next = tags.filter((_, i) => i !== index);
    emitChange(next);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      e.preventDefault();
      commitInput();
      return;
    }
    if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      emitChange(tags.slice(0, -1));
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const parsed = parseInputText(pasted);
    if (parsed.length > 0) {
      emitChange(dedupeTags(tags, parsed));
      setInputValue('');
    }
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      role="group"
      onClick={handleContainerClick}
      className={`flex flex-wrap items-center gap-2 min-h-[42px] border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white cursor-text transition-shadow ${
        focused ? `ring-2 ${ringClass}` : ''
      }`}
    >
      {tags.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium ${chipClass}`}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(index);
            }}
            className="rounded p-0.5 hover:bg-black/10 transition-colors"
            aria-label={`Remove ${tag}`}
          >
            <X size={14} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitInput();
        }}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] border-0 bg-transparent p-0 text-sm focus:outline-none focus:ring-0"
      />
      {required && (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={joinTags(tags)}
          onChange={() => {}}
          className="sr-only"
        />
      )}
    </div>
  );
}
