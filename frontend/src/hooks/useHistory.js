import { useReducer, useCallback, useMemo } from 'react';

function historyReducer(state, action) {
  const { history, index } = state;
  const currentPresent = history[index];

  switch (action.type) {
    case 'SET': {
      const { silent = false } = action;
      const nextState = typeof action.payload === 'function' 
        ? action.payload(currentPresent) 
        : action.payload;
      
      // Optimization: Don't record history if state hasn't actually changed
      if (JSON.stringify(nextState) === JSON.stringify(currentPresent)) {
        return state;
      }

      if (silent) {
        // Just update the present state without pushing to history
        const newHistory = [...history];
        newHistory[index] = nextState;
        return {
          ...state,
          history: newHistory
        };
      }

      const newHistory = history.slice(0, index + 1);
      newHistory.push(nextState);
      
      // Keep last 50 changes
      const limitedHistory = newHistory.length > 50 ? newHistory.slice(1) : newHistory;
      
      return {
        history: limitedHistory,
        index: limitedHistory.length - 1
      };
    }
    case 'UNDO': {
      if (index <= 0) return state;
      return {
        ...state,
        index: index - 1
      };
    }
    case 'REDO': {
      if (index >= history.length - 1) return state;
      return {
        ...state,
        index: index + 1
      };
    }
    default:
      return state;
  }
}

export default function useHistory(initialState) {
  const [state, dispatch] = useReducer(historyReducer, {
    history: [initialState],
    index: 0
  });

  const set = useCallback((payload, options = {}) => {
    dispatch({ type: 'SET', payload, silent: options.silent });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const present = useMemo(() => state.history[state.index], [state.history, state.index]);
  const canUndo = state.index > 0;
  const canRedo = state.index < state.history.length - 1;

  return [present, set, undo, redo, canUndo, canRedo];
}
