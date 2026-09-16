import { Check, ChevronDown, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { getModels, PlatformApiError, type ModelOption, type ModelSelection } from "../platforms/platformApi";

interface ModelPickerProps {
  readonly disabled?: boolean;
  readonly onChange: (selection: ModelSelection | null) => void;
  readonly value: ModelSelection | null;
}

export function ModelPicker({ disabled = false, onChange, value }: ModelPickerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const appliedDefault = useRef(false);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setIsLoading(true);
        setError(null);
      void getModels(query, controller.signal)
        .then((catalog) => {
          if (controller.signal.aborted) return;
          setModels(catalog.models);
          setDefaultModel(catalog.defaultModel);
          setActiveIndex(0);
          if (!valueRef.current && catalog.defaultModel && !appliedDefault.current) {
            const defaultOption = catalog.models.find((model) => model.id === catalog.defaultModel);
            appliedDefault.current = true;
            onChangeRef.current({ provider: "openrouter", model: defaultOption?.id ?? catalog.defaultModel, contextWindowTokens: defaultOption?.contextLength ?? undefined });
          }
        })
        .catch((requestError) => {
          if (isAbortError(requestError)) return;
          setError(toUserMessage(requestError));
          setModels([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, query ? 220 : 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, requestVersion]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const selectedOption = value ? models.find((model) => model.id === value.model) : undefined;
  const displayName = selectedOption?.name ?? value?.model ?? "Select a model";

  function openPicker() {
    if (!disabled) setIsOpen(true);
  }

  function selectModel(model: ModelOption | string) {
    onChange({ provider: "openrouter", model: typeof model === "string" ? model : model.id, contextWindowTokens: typeof model === "string" ? undefined : model.contextLength ?? undefined });
    setQuery("");
    setIsOpen(false);
  }

  function clearSelection() {
    onChange(null);
    setQuery("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(models.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && isOpen && models[activeIndex]) {
      event.preventDefault();
      selectModel(models[activeIndex]);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="model-picker">
      <span className="model-picker-label">Model</span>
      <div className={`model-picker-control ${isOpen ? "is-open" : ""}`}>
        <button aria-expanded={isOpen} aria-haspopup="dialog" className="model-picker-trigger" disabled={disabled} onClick={openPicker} type="button">
          <Search aria-hidden="true" className="model-picker-search-icon" size={14} />
          <span className={value ? "model-picker-trigger-name" : "model-picker-trigger-placeholder"}>{displayName}</span>
          <ChevronDown aria-hidden="true" className="model-picker-chevron" size={14} />
        </button>
        {value && <button aria-label="Clear selected model" className="model-picker-clear" disabled={disabled} onClick={clearSelection} type="button"><X aria-hidden="true" size={14} /></button>}
      </div>

      {isOpen && !disabled && (
        <div className="model-select-backdrop" onMouseDown={() => setIsOpen(false)} role="presentation">
          <section aria-labelledby={`${listboxId}-title`} aria-modal="true" className="model-select-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <header className="model-select-header">
              <div><span className="eyebrow">OpenRouter</span><h2 id={`${listboxId}-title`}>Select a model</h2></div>
              <button aria-label="Close model selection" className="icon-button" onClick={() => setIsOpen(false)} type="button"><X aria-hidden="true" size={17} /></button>
            </header>
            <div className="model-select-search">
              <Search aria-hidden="true" size={15} />
              <input
                aria-activedescendant={models[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-expanded="true"
                aria-label="Search OpenRouter models"
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search models"
                ref={inputRef}
                role="combobox"
                type="search"
                value={query}
              />
            </div>
            <div className="model-select-list" id={listboxId} role="listbox">
              {isLoading && <div className="model-picker-state"><LoaderCircle aria-hidden="true" className="is-spinning" size={14} /> Searching</div>}
              {!isLoading && error && (
                <div className="model-picker-state model-picker-error" role="alert">
                  <span>{error}</span>
                  <button aria-label="Retry model search" className="model-picker-retry" onClick={() => setRequestVersion((current) => current + 1)} type="button"><RefreshCw aria-hidden="true" size={13} /></button>
                </div>
              )}
              {!isLoading && !error && models.length === 0 && <div className="model-picker-state">No models found</div>}
              {!isLoading && !error && models.map((model, index) => (
                <button
                  aria-selected={value?.model === model.id}
                  className={`model-picker-option ${index === activeIndex ? "is-active" : ""}`}
                  id={`${listboxId}-${index}`}
                  key={model.id}
                  onClick={() => selectModel(model)}
                  role="option"
                  type="button"
                >
                  <span className="model-picker-option-copy"><strong>{model.name}</strong><code>{model.id}</code></span>
                  <span className="model-picker-option-meta">{model.isFree ? "Free" : formatPrice(model)}{model.contextLength ? ` · ${formatContext(model.contextLength)}` : ""}</span>
                  {value?.model === model.id && <Check aria-hidden="true" size={14} />}
                </button>
              ))}
              {defaultModel && !value && <small className="model-picker-footnote">Default: {defaultModel}</small>}
            </div>
            <footer className="model-select-footer"><span>{models.length} models</span><button className="quiet-button" onClick={() => setIsOpen(false)} type="button">Cancel</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}

function formatPrice(model: ModelOption): string {
  if (model.promptPriceUsdPerMillion === null) return "Pricing unavailable";
  return `$${model.promptPriceUsdPerMillion.toFixed(model.promptPriceUsdPerMillion < 0.01 ? 4 : 2)}/M in`;
}

function formatContext(value: number): string {
  return `${Math.round(value / 1_000)}k ctx`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function toUserMessage(error: unknown): string {
  if (error instanceof PlatformApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The model catalog could not be loaded.";
}
