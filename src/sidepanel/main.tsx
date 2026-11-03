import { render } from 'preact';
import '../styles/tokens.css';
import './panel.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);
